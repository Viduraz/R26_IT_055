import asyncio
import os
import sys
from pathlib import Path
import numpy as np

# Ensure backend root is in sys.path
backend_root = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_root))

from config import settings
from database.connection import MongoDB
from database.crud import UserCRUD, FeatureProfileCRUD
from services.identification.models.biometric_template import BiometricTemplateMatcher

async def diagnose():
    print("=== SKELETON BIOMETRIC SYSTEM DIAGNOSTIC ===")
    print("MongoDB URL:", settings.mongodb_uri)
    
    # 1. Connect DB
    await MongoDB.connect()
    print("Database connected. Is Local?", MongoDB._is_local)
    
    # 2. List Users
    users = await UserCRUD.list_all()
    print(f"\n[1] Total Users in DB: {len(users)}")
    for u in users:
        print(f"  - ID: '{u.get('user_id')}', Name: '{u.get('name')}', Role: '{u.get('role')}'")

    # 3. List Feature Profiles
    profiles = await FeatureProfileCRUD.get_all_profiles()
    print(f"\n[2] Total Feature Profiles in DB: {len(profiles)}")
    for p in profiles:
        uid = p.get('user_id')
        static_data = p.get('static_features', {})
        samples = static_data.get('samples', [])
        mean_vec = static_data.get('mean_vector')
        print(f"  - User ID: '{uid}' | Samples: {len(samples)} | Mean Vec Length: {len(mean_vec) if mean_vec else 0}")

    # 4. Load into BiometricTemplateMatcher
    matcher = BiometricTemplateMatcher(acceptance_threshold=0.45)
    num_loaded = matcher.load_from_profiles(profiles)
    print(f"\n[3] BiometricTemplateMatcher loaded {num_loaded} template(s)")
    for uid, tmpl in matcher.templates.items():
        print(f"  - Template for '{uid}': {tmpl['sample_count']} valid samples, centroid norm={np.linalg.norm(tmpl['centroid']):.4f}")

    # 5. Check match scores for enrolled samples
    print("\n[4] Self-Match & Cross-Match Matrix:")
    for p in profiles:
        uid = p.get('user_id')
        samples = p.get('static_features', {}).get('samples', [])
        if samples:
            test_vec = np.array(samples[0])
            res = matcher.identify(test_vec)
            top_k = res.get('top_k', [])
            top_info = [(cand.get('user_id'), cand.get('confidence')) for cand in top_k]
            print(f"  - Query Profile '{uid}': predicted='{res.get('predicted_user')}', conf={res.get('confidence')}, status='{res.get('status')}', top_candidates={top_info}")

    await MongoDB.close()

if __name__ == "__main__":
    asyncio.run(diagnose())
