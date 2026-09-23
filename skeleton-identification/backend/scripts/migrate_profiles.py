import asyncio
import sys
import json
import numpy as np
from pathlib import Path

backend_dir = Path('.').resolve()
sys.path.insert(0, str(backend_dir))

from database.connection import MongoDB
from database.crud import FeatureProfileCRUD

OLD_KEYS = [
    'arm_to_torso_ratio', 'height_estimate', 'hip_width', 'hip_width_norm',
    'left_elbow_angle', 'left_forearm', 'left_forearm_norm', 'left_hip_angle',
    'left_knee_angle', 'left_right_arm_symmetry', 'left_right_leg_symmetry',
    'left_shin', 'left_shin_norm', 'left_shoulder_angle', 'left_thigh',
    'left_thigh_norm', 'left_torso', 'left_torso_norm', 'left_upper_arm',
    'left_upper_arm_norm', 'right_elbow_angle', 'right_forearm',
    'right_forearm_norm', 'right_hip_angle', 'right_knee_angle',
    'right_shin', 'right_shin_norm', 'right_shoulder_angle', 'right_thigh',
    'right_thigh_norm', 'right_torso', 'right_torso_norm', 'right_upper_arm',
    'right_upper_arm_norm', 'shoulder_to_hip_ratio', 'shoulder_width',
    'shoulder_width_norm', 'torso_length', 'torso_to_leg_ratio',
    'upper_to_lower_body_ratio'
]

NEW_KEYS = sorted([
    'left_upper_arm_norm', 'left_forearm_norm', 'right_upper_arm_norm', 'right_forearm_norm',
    'shoulder_width_norm', 'left_torso_norm', 'right_torso_norm', 'hip_width_norm',
    'left_thigh_norm', 'left_shin_norm', 'right_thigh_norm', 'right_shin_norm',
    'left_elbow_angle_norm', 'right_elbow_angle_norm', 'left_shoulder_angle_norm', 'right_shoulder_angle_norm',
    'left_hip_angle_norm', 'right_hip_angle_norm', 'left_knee_angle_norm', 'right_knee_angle_norm',
    'torso_to_leg_ratio', 'arm_to_torso_ratio', 'shoulder_to_hip_ratio', 'upper_to_lower_arm_ratio',
    'thigh_to_shin_ratio', 'arm_to_leg_ratio', 'left_right_arm_symmetry', 'left_right_leg_symmetry',
    'upper_to_lower_body_ratio', 'torso_aspect_ratio', 'pelvis_to_torso_ratio',
    'wingspan_to_height_ratio', 'left_limb_to_height_ratio', 'right_limb_to_height_ratio',
    'rel_left_wrist_dist', 'rel_right_wrist_dist', 'rel_left_elbow_dist',
    'rel_right_elbow_dist', 'rel_left_ankle_dist', 'rel_right_ankle_dist',
])

def migrate_vector(old_v):
    if len(old_v) != 40:
        return old_v
    if max(old_v) < 15.0:
        return old_v
    od = {OLD_KEYS[i]: float(old_v[i]) for i in range(40)}
    nd = {}
    for k in ['left_upper_arm_norm', 'left_forearm_norm', 'right_upper_arm_norm', 'right_forearm_norm',
              'shoulder_width_norm', 'left_torso_norm', 'right_torso_norm', 'hip_width_norm',
              'left_thigh_norm', 'left_shin_norm', 'right_thigh_norm', 'right_shin_norm']:
        nd[k] = od.get(k, 0.5)
    nd['left_elbow_angle_norm'] = od['left_elbow_angle'] / 180.0
    nd['right_elbow_angle_norm'] = od['right_elbow_angle'] / 180.0
    nd['left_shoulder_angle_norm'] = od['left_shoulder_angle'] / 180.0
    nd['right_shoulder_angle_norm'] = od['right_shoulder_angle'] / 180.0
    nd['left_hip_angle_norm'] = od['left_hip_angle'] / 180.0
    nd['right_hip_angle_norm'] = od['right_hip_angle'] / 180.0
    nd['left_knee_angle_norm'] = od['left_knee_angle'] / 180.0
    nd['right_knee_angle_norm'] = od['right_knee_angle'] / 180.0
    nd['torso_to_leg_ratio'] = od['torso_to_leg_ratio']
    nd['arm_to_torso_ratio'] = od['arm_to_torso_ratio']
    nd['shoulder_to_hip_ratio'] = od['shoulder_to_hip_ratio']
    nd['left_right_arm_symmetry'] = od['left_right_arm_symmetry']
    nd['left_right_leg_symmetry'] = od['left_right_leg_symmetry']
    nd['upper_to_lower_body_ratio'] = od['upper_to_lower_body_ratio']
    avg_u = (od['left_upper_arm_norm'] + od['right_upper_arm_norm']) / 2.0
    avg_f = (od['left_forearm_norm'] + od['right_forearm_norm']) / 2.0
    nd['upper_to_lower_arm_ratio'] = avg_u / (avg_f + 1e-4)
    avg_t = (od['left_thigh_norm'] + od['right_thigh_norm']) / 2.0
    avg_s = (od['left_shin_norm'] + od['right_shin_norm']) / 2.0
    nd['thigh_to_shin_ratio'] = avg_t / (avg_s + 1e-4)
    nd['arm_to_leg_ratio'] = od['torso_to_leg_ratio'] * od['arm_to_torso_ratio']
    nd['torso_aspect_ratio'] = 1.0 / (od['shoulder_width_norm'] + 1e-4)
    nd['pelvis_to_torso_ratio'] = od['hip_width_norm']
    leg_norm = avg_t + avg_s
    h_est = 1.0 + leg_norm
    arm_norm = avg_u + avg_f
    nd['wingspan_to_height_ratio'] = (2.0 * arm_norm + od['shoulder_width_norm']) / h_est
    nd['left_limb_to_height_ratio'] = (od['left_thigh_norm'] + od['left_shin_norm']) / h_est
    nd['right_limb_to_height_ratio'] = (od['right_thigh_norm'] + od['right_shin_norm']) / h_est
    nd['rel_left_wrist_dist'] = 0.85 * (od['left_upper_arm_norm'] + od['left_forearm_norm'])
    nd['rel_right_wrist_dist'] = 0.85 * (od['right_upper_arm_norm'] + od['right_forearm_norm'])
    nd['rel_left_elbow_dist'] = 0.65 * od['left_upper_arm_norm']
    nd['rel_right_elbow_dist'] = 0.65 * od['right_upper_arm_norm']
    nd['rel_left_ankle_dist'] = od['left_thigh_norm'] + od['left_shin_norm']
    nd['rel_right_ankle_dist'] = od['right_thigh_norm'] + od['right_shin_norm']
    return [float(nd[k]) for k in NEW_KEYS]

async def run_migration():
    await MongoDB.connect()
    profiles = await FeatureProfileCRUD.get_all_profiles()
    print('Migrating', len(profiles), 'profiles in MongoDB Atlas...')
    db = MongoDB.get_db()
    for p in profiles:
        uid = p.get('user_id')
        static = p.get('static_features', {})
        samples = static.get('samples', [])
        mean_v = static.get('mean_vector', [])
        
        migrated_samples = [migrate_vector(s) for s in samples]
        migrated_mean = migrate_vector(mean_v) if mean_v else []
        if migrated_samples and not migrated_mean:
            migrated_mean = np.mean(migrated_samples, axis=0).tolist()
        
        new_static = {
            'mean_vector': migrated_mean,
            'std_vector': np.std(migrated_samples, axis=0).tolist() if migrated_samples else [],
            'samples': migrated_samples,
        }
        
        await db.feature_profiles.update_one(
            {'user_id': uid},
            {'$set': {'static_features': new_static}}
        )
        print(f'Migrated user {uid}: {len(migrated_samples)} samples, max val = {round(max(migrated_mean), 2) if migrated_mean else None}')

asyncio.run(run_migration())
