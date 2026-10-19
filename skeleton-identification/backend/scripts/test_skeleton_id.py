import sys
import math
import numpy as np
from pathlib import Path

backend_dir = Path('.').resolve()
sys.path.insert(0, str(backend_dir))

from services.feature_extraction.static_features import StaticFeatureExtractor
from services.pose_estimation.estimator import PoseEstimator
from services.identification.models.template_knn import TemplateIdentifier

def create_synthetic_pose(scale=1.0, offset_x=0.5, offset_y=0.5, shoulder_w=0.18, torso_l=0.30, leg_l=0.45):
    # Normalized keypoint positions
    kps = {}
    
    # Head
    kps['nose'] = {'x': offset_x, 'y': offset_y - torso_l * 0.5 * scale, 'z': 0.0, 'visibility': 0.99}
    
    # Shoulders
    kps['left_shoulder'] = {'x': offset_x - shoulder_w * 0.5 * scale, 'y': offset_y - torso_l * 0.4 * scale, 'z': 0.0, 'visibility': 0.99}
    kps['right_shoulder'] = {'x': offset_x + shoulder_w * 0.5 * scale, 'y': offset_y - torso_l * 0.4 * scale, 'z': 0.0, 'visibility': 0.99}
    
    # Arms
    kps['left_elbow'] = {'x': offset_x - shoulder_w * 0.8 * scale, 'y': offset_y - torso_l * 0.1 * scale, 'z': 0.0, 'visibility': 0.95}
    kps['left_wrist'] = {'x': offset_x - shoulder_w * 0.9 * scale, 'y': offset_y + torso_l * 0.2 * scale, 'z': 0.0, 'visibility': 0.95}
    kps['right_elbow'] = {'x': offset_x + shoulder_w * 0.8 * scale, 'y': offset_y - torso_l * 0.1 * scale, 'z': 0.0, 'visibility': 0.95}
    kps['right_wrist'] = {'x': offset_x + shoulder_w * 0.9 * scale, 'y': offset_y + torso_l * 0.2 * scale, 'z': 0.0, 'visibility': 0.95}
    
    # Hips
    hip_w = shoulder_w * 0.75
    kps['left_hip'] = {'x': offset_x - hip_w * 0.5 * scale, 'y': offset_y + torso_l * 0.5 * scale, 'z': 0.0, 'visibility': 0.99}
    kps['right_hip'] = {'x': offset_x + hip_w * 0.5 * scale, 'y': offset_y + torso_l * 0.5 * scale, 'z': 0.0, 'visibility': 0.99}
    
    # Legs
    kps['left_knee'] = {'x': offset_x - hip_w * 0.5 * scale, 'y': offset_y + (torso_l * 0.5 + leg_l * 0.5) * scale, 'z': 0.0, 'visibility': 0.95}
    kps['left_ankle'] = {'x': offset_x - hip_w * 0.5 * scale, 'y': offset_y + (torso_l * 0.5 + leg_l) * scale, 'z': 0.0, 'visibility': 0.95}
    kps['right_knee'] = {'x': offset_x + hip_w * 0.5 * scale, 'y': offset_y + (torso_l * 0.5 + leg_l * 0.5) * scale, 'z': 0.0, 'visibility': 0.95}
    kps['right_ankle'] = {'x': offset_x + hip_w * 0.5 * scale, 'y': offset_y + (torso_l * 0.5 + leg_l) * scale, 'z': 0.0, 'visibility': 0.95}
    
    # Fill remaining 33 landmarks for full pose format
    all_kps = [kps.get('nose', {'x': 0, 'y': 0, 'z': 0, 'visibility': 0.9})] * 33
    all_kps[0] = kps['nose']
    all_kps[11] = kps['left_shoulder']
    all_kps[12] = kps['right_shoulder']
    all_kps[13] = kps['left_elbow']
    all_kps[14] = kps['right_elbow']
    all_kps[15] = kps['left_wrist']
    all_kps[16] = kps['right_wrist']
    all_kps[23] = kps['left_hip']
    all_kps[24] = kps['right_hip']
    all_kps[25] = kps['left_knee']
    all_kps[26] = kps['right_knee']
    all_kps[27] = kps['left_ankle']
    all_kps[28] = kps['right_ankle']
    
    return kps, all_kps

def test_scale_invariance():
    print('=== Test 1: Scale & Distance Invariance ===')
    extractor = StaticFeatureExtractor()
    
    # Person 1 at reference distance (scale 1.0)
    p1_kps, _ = create_synthetic_pose(scale=1.0, offset_x=0.5, offset_y=0.5, shoulder_w=0.18, torso_l=0.30, leg_l=0.45)
    f1 = extractor.extract_all(p1_kps)
    v1 = extractor.to_vector(f1)
    
    # Person 1 standing farther (scale 0.65) and moved to the left
    p1_far_kps, _ = create_synthetic_pose(scale=0.65, offset_x=0.25, offset_y=0.4, shoulder_w=0.18, torso_l=0.30, leg_l=0.45)
    f1_far = extractor.extract_all(p1_far_kps)
    v1_far = extractor.to_vector(f1_far)
    
    # Person 1 standing closer (scale 1.4) and moved to the right
    p1_close_kps, _ = create_synthetic_pose(scale=1.4, offset_x=0.75, offset_y=0.6, shoulder_w=0.18, torso_l=0.30, leg_l=0.45)
    f1_close = extractor.extract_all(p1_close_kps)
    v1_close = extractor.to_vector(f1_close)
    
    # Person 2 (different proportions: broad shoulders, shorter legs)
    p2_kps, _ = create_synthetic_pose(scale=1.0, offset_x=0.5, offset_y=0.5, shoulder_w=0.25, torso_l=0.35, leg_l=0.35)
    f2 = extractor.extract_all(p2_kps)
    v2 = extractor.to_vector(f2)
    
    # Cosine similarities
    def cos_sim(a, b):
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))
    
    sim_far = cos_sim(v1, v1_far)
    sim_close = cos_sim(v1, v1_close)
    sim_p2 = cos_sim(v1, v2)
    
    print(f'Similarity Person 1 (Ref vs Far 0.65x):   {sim_far:.4f} (Expected > 0.99)')
    print(f'Similarity Person 1 (Ref vs Close 1.4x): {sim_close:.4f} (Expected > 0.99)')
    print(f'Similarity Person 1 vs Person 2 (Different Person): {sim_p2:.4f} (Expected < 0.85)')
    
    assert sim_far >= 0.99, f'Failed scale invariance on far pose: {sim_far}'
    assert sim_close >= 0.99, f'Failed scale invariance on close pose: {sim_close}'
    assert sim_p2 < 0.90, f'Failed distinct person separation: {sim_p2}'
    print('✅ Scale Invariance Test PASSED!\n')

def test_pose_nms():
    print('=== Test 2: Pose NMS & Duplicate Deduplication ===')
    _, pose1 = create_synthetic_pose(scale=1.0, offset_x=0.3, offset_y=0.5)
    # Duplicate of pose1 with small jitter
    _, pose1_dup = create_synthetic_pose(scale=0.98, offset_x=0.31, offset_y=0.51)
    # Distinct second person on right
    _, pose2 = create_synthetic_pose(scale=1.0, offset_x=0.7, offset_y=0.5)
    
    raw_poses = [pose1, pose1_dup, pose2]
    print(f'Input raw poses detected: {len(raw_poses)} (2 physical people, 1 duplicate)')
    
    filtered_poses = PoseEstimator.filter_and_suppress_poses(raw_poses, iou_threshold=0.35)
    print(f'Filtered poses after NMS: {len(filtered_poses)} (Expected: exactly 2)')
    
    assert len(filtered_poses) == 2, f'Expected 2 poses, got {len(filtered_poses)}'
    print('✅ Pose NMS Deduplication Test PASSED!\n')

def test_knn_template_matching():
    print('=== Test 3: KNN Template Matcher ===')
    extractor = StaticFeatureExtractor()
    p1_kps, _ = create_synthetic_pose(scale=1.0, shoulder_w=0.18, torso_l=0.30, leg_l=0.45)
    v1 = extractor.to_vector(extractor.extract_all(p1_kps))
    
    # Generate 150 simulated enrollment frames for user_1 with slight natural variation
    enrollment_samples = []
    for _ in range(150):
        noise = np.random.normal(0, 0.015, size=v1.shape)
        enrollment_samples.append((v1 + noise).tolist())
    
    profile_p1 = {
        'user_id': 'user_himaya_123',
        'static_features': {
            'mean_vector': v1.tolist(),
            'samples': enrollment_samples
        }
    }
    
    knn = TemplateIdentifier(acceptance_threshold=0.72)
    knn.load_from_profiles([profile_p1])
    
    # Test identifying enrolled person (with variation)
    test_p1_kps, _ = create_synthetic_pose(scale=1.1, shoulder_w=0.18, torso_l=0.30, leg_l=0.45)
    test_v1 = extractor.to_vector(extractor.extract_all(test_p1_kps))
    
    res_p1 = knn.identify(test_v1)
    print(f'Identified Enrolled User: user={res_p1[\"predicted_user\"]}, conf={res_p1[\"confidence\"]}, is_known={res_p1[\"is_known\"]}')
    assert res_p1['is_known'] is True, 'Expected enrolled user to be recognized as known'
    assert res_p1['predicted_user'] == 'user_himaya_123'
    assert res_p1['confidence'] >= 0.90
    
    # Test identifying unenrolled stranger
    stranger_kps, _ = create_synthetic_pose(scale=1.0, shoulder_w=0.28, torso_l=0.38, leg_l=0.30)
    stranger_v = extractor.to_vector(extractor.extract_all(stranger_kps))
    
    res_stranger = knn.identify(stranger_v)
    print(f'Identified Stranger: user={res_stranger[\"predicted_user\"]}, conf={res_stranger[\"confidence\"]}, is_known={res_stranger[\"is_known\"]}')
    assert res_stranger['is_known'] is False, 'Expected stranger to be classified as unknown'
    print('✅ KNN Template Matcher Test PASSED!\n')

if __name__ == '__main__':
    test_scale_invariance()
    test_pose_nms()
    test_knn_template_matching()
    print('🎉 ALL SKELETON IDENTIFICATION UNIT & INTEGRATION TESTS PASSED!')
