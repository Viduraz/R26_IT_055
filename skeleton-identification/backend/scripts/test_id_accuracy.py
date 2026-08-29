import asyncio
import sys
import numpy as np
from pathlib import Path

backend_dir = Path('.').resolve()
sys.path.insert(0, str(backend_dir))

from database.connection import MongoDB
from database.crud import UserCRUD, FeatureProfileCRUD
from services.identification.predictor import Predictor

async def test_identification():
    await MongoDB.connect()
    users = await UserCRUD.list_all()
    profiles = await FeatureProfileCRUD.get_all_profiles()
    print(f"=== Testing Identification with {len(users)} Users & {len(profiles)} Profiles ===")
    
    predictor = Predictor()
    user_map = {u["user_id"]: u["name"] for u in users}
    predictor.load_knn_templates(profiles)
    
    print("KNN Ready:", predictor.knn_ready)
    print("KNN Users in Memory:", len(predictor.knn.templates))
    
    # Test each enrolled user against their own profile
    correct = 0
    total = 0
    for p in profiles:
        uid = p.get("user_id")
        name = user_map.get(uid, "Unknown")
        samples = p.get("static_features", {}).get("samples", [])
        if not samples:
            continue
        
        # Test on 3 representative samples from this user (e.g., indices 5, 20, 40)
        n_samples = len(samples)
        test_indices = [min(5, n_samples - 1), min(n_samples // 2, n_samples - 1), min(n_samples - 5, n_samples - 1)]
        test_indices = sorted(list(set(test_indices)))
        for idx in test_indices:
            s = samples[idx]
            res = predictor.identify(static_features=np.array(s))
            pred_uid = res.get("predicted_user")
            pred_name = user_map.get(pred_uid, "Unknown")
            conf = res.get("confidence")
            is_k = res.get("is_known")
            
            is_correct = (pred_uid == uid) and is_k
            total += 1
            if is_correct:
                correct += 1
            status_str = "PASS" if is_correct else "FAIL"
            print(f"User [{name:15s} ({uid[:8]}...)]: Predicted [{pred_name:15s}], Confidence={conf:.4f}, Known={is_k} -> {status_str}")
            
    # Test on a simulated stranger (random/unseen body)
    stranger = np.array([0.3, 0.4, 0.2, 0.1, 0.3, 0.2, 0.1, 0.5, 0.7, 0.8, 0.3, 0.2, 0.4, 0.3, 0.2, 0.3, 0.4, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.1, 0.4, 0.2, 0.3, 0.3, 0.4, 0.3, 0.8, 0.4, 1.2, 2.0, 0.6, 1.1, 0.9, 0.8])
    s_res = predictor.identify(static_features=stranger)
    s_pred_name = user_map.get(s_res.get("predicted_user"), "Unknown")
    s_conf = s_res.get("confidence")
    s_k = s_res.get("is_known")
    s_status = "PASS (Correctly Unknown)" if not s_k else "FAIL (False Positive)"
    print(f"\nStranger Test: Predicted [{s_pred_name}], Confidence={s_conf:.4f}, Known={s_k} -> {s_status}")

    pct = (correct / total * 100) if total > 0 else 0
    print(f"\nTotal Test Passed: {correct}/{total} ({pct:.1f}%)")

if __name__ == "__main__":
    asyncio.run(test_identification())
