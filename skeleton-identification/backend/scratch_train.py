import asyncio
import os
import sys
import time
import numpy as np
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(dotenv_path=str(backend_dir.parent.parent / ".env"))

from config import settings
from database.connection import MongoDB
from database.crud import UserCRUD, FeatureProfileCRUD
from services.identification.predictor import Predictor
from gateway.routes.stream import StreamPipeline

async def test_all():
    print("=== 1. Testing MongoDB Connection & Index Creation ===")
    t0 = time.perf_counter()
    await MongoDB.connect(settings.mongodb_uri, settings.mongodb_db)
    print(f"MongoDB connected in {(time.perf_counter() - t0)*1000:.1f}ms")
    
    print("=== 2. Testing Fast Local DB Sync ===")
    t0 = time.perf_counter()
    await MongoDB.sync_local_db()
    print(f"Local DB sync completed in {(time.perf_counter() - t0)*1000:.1f}ms")
    
    print("=== 3. Testing Model Loading (SVM + LSTM + KNN) ===")
    pred = Predictor()
    pred.load_models()
    profiles = await FeatureProfileCRUD.get_all_profiles()
    knn_count = pred.load_knn_templates(profiles)
    print(f"SVM Ready: {pred.ensemble.svm_ready}, LSTM Ready: {pred.ensemble.lstm_ready}, KNN Ready: {pred.knn_ready} ({knn_count} users), Overall Ready: {pred.is_ready}")
    assert pred.is_ready, "Predictor must be ready"
    assert pred.ensemble.svm_ready, "SVM must be ready"
    assert pred.ensemble.lstm_ready, "LSTM must be ready"
    assert pred.knn_ready, "KNN must be ready"
    
    users = await UserCRUD.list_all()
    user_map = {u["user_id"]: u["name"] for u in users}
    print(f"Found {len(users)} users in database: {list(user_map.values())}")
    
    print("=== 4. Testing Enrolled User Identification vs Unknown Person ===")
    # Test profile samples
    for idx, p in enumerate(profiles[:3]):
        uid = p["user_id"]
        sample = p["static_features"]["samples"][0]
        res = pred.identify(static_features=np.array(sample))
        uname = user_map.get(uid, uid)
        pname = user_map.get(res["predicted_user"], res["predicted_user"])
        print(f"Profile {idx} ({uname}): predicted={pname}, conf={res['confidence']}, known={res['is_known']}, method={res['method']}")
        assert res["is_known"] == True, f"Enrolled user {uname} should be recognized"
        assert res["predicted_user"] == uid, f"Expected {uid}, got {res['predicted_user']}"
    
    # Test random / unregistered vector
    rand_vec = np.random.uniform(0.1, 1.5, size=40)
    res_rand = pred.identify(static_features=rand_vec)
    print(f"Unregistered random vector: predicted={res_rand['predicted_user']}, conf={res_rand['confidence']}, known={res_rand['is_known']}, method={res_rand['method']}")
    assert res_rand["is_known"] == False, "Unregistered user must NOT be recognized as known"
    assert res_rand["predicted_user"] == "unknown", "Unregistered user must be unknown"
    
    print("=== 5. Testing Immediate Real-Time Identification ===")
    pipeline = StreamPipeline(pred)
    pipeline.user_name_map = user_map
    
    # 1. Person A enters -> Immediate Frame-1 Identification
    pA = profiles[0]
    pA_uid = pA["user_id"]
    pA_name = user_map.get(pA_uid, "Person A")
    print(f"Frame 1 of {pA_name}...")
    pipeline._update_single_track(pA_uid, 0.92, True, "knn")
    print(f"State on Frame 1: state={pipeline.single_track['state']}, name={pipeline.single_track['committed_name']}")
    assert pipeline.single_track["state"] == "identified"
    assert pipeline.single_track["committed_name"] == pA_name
    assert pipeline.single_track["committed_is_known"] == True
    
    # 2. Person B (friend) enters -> Immediate Frame-1 Switch
    pB = profiles[1]
    pB_uid = pB["user_id"]
    pB_name = user_map.get(pB_uid, "Person B")
    print(f"Frame 1 of switching to {pB_name} (friend)...")
    pipeline._update_single_track(pB_uid, 0.90, True, "knn")
    print(f"State on Frame 1 of {pB_name}: state={pipeline.single_track['state']}, name={pipeline.single_track['committed_name']}")
    assert pipeline.single_track["state"] == "identified"
    assert pipeline.single_track["committed_name"] == pB_name
    assert pipeline.single_track["committed_is_known"] == True
    
    # 3. Unknown Person enters -> Immediate Frame-1 Unknown
    print("Frame 1 of Unknown Person entering...")
    pipeline._update_single_track("unknown", 0.20, False, "knn_rejected")
    print(f"State on Frame 1 of Unknown Person: state={pipeline.single_track['state']}, name={pipeline.single_track['committed_name']}, known={pipeline.single_track['committed_is_known']}")
    assert pipeline.single_track["state"] == "unknown"
    assert pipeline.single_track["committed_name"] == "Unknown Person"
    assert pipeline.single_track["committed_is_known"] == False
    
    await MongoDB.close()
    print("\nALL TESTS PASSED SUCCESSFULLY! :)")

if __name__ == "__main__":
    asyncio.run(test_all())

