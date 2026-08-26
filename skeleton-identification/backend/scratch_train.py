import asyncio
import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
# Load environment from root .env
load_dotenv(dotenv_path=str(backend_dir.parent.parent / ".env"))

from config import settings
from database.connection import MongoDB
from database.crud import UserCRUD, FeatureProfileCRUD, ModelCRUD
from database.schemas import TrainedModelRecord
from services.identification.trainer import ModelTrainer
from services.identification.predictor import Predictor

async def main():
    print("Connecting to database...")
    await MongoDB.connect(settings.mongodb_uri, settings.mongodb_db)
    
    db = MongoDB.get_db()
    
    print("\n--- 1. Checking Users and Profiles ---")
    users = await UserCRUD.list_all()
    user_ids = {u["user_id"] for u in users if u.get("user_id")}
    user_names = {u["user_id"]: u["name"] for u in users if u.get("user_id")}
    
    profiles = await FeatureProfileCRUD.get_all_profiles()
    profile_ids = {p["user_id"] for p in profiles}
    
    print(f"Total Users: {len(users)}")
    print(f"Users with IDs: {len(user_ids)}")
    print(f"Total Feature Profiles: {len(profiles)}")
    
    orphaned_ids = profile_ids - user_ids
    print(f"Orphaned Profiles: {orphaned_ids}")
    
    # 2. Delete orphaned profiles
    if orphaned_ids:
        print("\n--- 2. Deleting Orphaned Profiles ---")
        for oid in orphaned_ids:
            res = await db.feature_profiles.delete_one({"user_id": oid})
            print(f"Deleted profile {oid}: {res.deleted_count} doc(s)")
    else:
        print("\nNo orphaned profiles to delete.")

    # 3. Clean up duplicate/empty "Binushi Himaya" records if they don't have user_id
    # Wait, the auth service creates caregivers in the users collection.
    # We should make sure we don't delete caregivers enrolled via auth-service.
    # However, for skeleton-identification, it expects user_id. Let's see if we should assign them a user_id!
    print("\n--- 3. Checking for Users without user_id ---")
    no_id_users = list(await db.users.find({"user_id": {"$exists": False}}).to_list(100))
    print(f"Users without user_id: {len(no_id_users)}")
    
    import uuid
    updated_count = 0
    for u in no_id_users:
        # Assign a user_id to these users so that skeleton-identification can map/query them!
        uid = str(uuid.uuid4())
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"user_id": uid}})
        print(f"Assigned user_id={uid} to user '{u.get('name')}' (role: {u.get('role')})")
        updated_count += 1
    if updated_count:
        print(f"Successfully updated {updated_count} user(s) with new user_ids.")

    # 4. Trigger training on the clean profiles
    print("\n--- 4. Training Models ---")
    # Fetch updated data
    data = await FeatureProfileCRUD.get_training_data()
    static_X = data["static_X"]
    static_y = data["static_y"]
    gait_X = data["gait_X"]
    gait_y = data["gait_y"]
    
    print(f"Training samples: static_X={static_X.shape}, static_y={static_y.shape}")
    print(f"Unique classes in training data: {set(static_y)}")
    for uid in set(static_y):
        name = user_names.get(uid, "Unknown")
        print(f"  Class: {uid} ({name}) -> {list(static_y).count(uid)} samples")
        
    if len(set(static_y)) < 2:
        print("Error: Need at least 2 classes to train SVM.")
        # Let's check if we can synthesize a dummy second class from himaya's data if needed, or if we have another user.
        # But wait! The Atlas database has 10 feature profiles:
        # e.g., 5c677989, 4426262a, f4df8179, etc.
        # So we should have enough classes!
        
    trainer = ModelTrainer(model_dir=settings.model_dir)
    
    # Train SVM
    svm_result = await trainer.train_svm(static_X, static_y)
    print("SVM Training Result:", svm_result)
    if svm_result["success"]:
        record = TrainedModelRecord(
            model_type="svm",
            version=svm_result["version"],
            num_classes=svm_result["metrics"]["num_classes"],
            accuracy=svm_result["metrics"]["train_accuracy"],
            f1_score=svm_result["metrics"]["train_f1_macro"],
            model_path=str(settings.model_dir),
            is_active=True,
            metrics=svm_result["metrics"],
        )
        await ModelCRUD.save_record(record)
        print("Saved SVM model record to DB.")

    # Train LSTM if we have gait sequence data
    if len(gait_X) > 0:
        try:
            # Reshape if needed
            reshaped_gait_X = gait_X.reshape(-1, 30, 8) if gait_X.ndim == 2 and gait_X.shape[1] == 240 else gait_X
            lstm_result = await trainer.train_lstm(
                reshaped_gait_X,
                gait_y,
                epochs=50,
                batch_size=32,
            )
            print("LSTM Training Result:", lstm_result)
            if lstm_result and lstm_result.get("success"):
                record = TrainedModelRecord(
                    model_type="lstm",
                    version=lstm_result["version"],
                    num_classes=lstm_result["metrics"]["num_classes"],
                    accuracy=lstm_result["metrics"].get("val_accuracy", 0),
                    f1_score=lstm_result["metrics"].get("best_val_f1", 0),
                    model_path=str(settings.model_dir),
                    is_active=True,
                    metrics=lstm_result["metrics"],
                )
                await ModelCRUD.save_record(record)
                print("Saved LSTM model record to DB.")
        except Exception as e:
            print("LSTM training failed/skipped:", e)

    print("\n--- 5. Verifying Loaded Model ---")
    predictor = Predictor(
        model_dir=settings.model_dir,
        svm_weight=settings.svm_weight,
        lstm_weight=settings.lstm_weight,
        confidence_threshold=settings.confidence_threshold,
    )
    loaded = predictor.load_models()
    print(f"Predictor ready: {predictor.is_ready}, Loaded classes: {predictor.ensemble.svm.label_encoder.classes_ if predictor.is_ready else 'N/A'}")
    
    await MongoDB.close()

if __name__ == "__main__":
    asyncio.run(main())
