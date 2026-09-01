#!/usr/bin/env python3
"""
preprocess_rf_data.py

Preprocesses har_session_*.json files (collected from DataCollector.jsx)
and generates X.npy and y.npy for training.

── Input ───────────────────────────────────────────────────────────────────
  ./data/har_session_*.json
  Each file should have:
    {
      "frames": [
        {
          "activity": "Walking",  // activity label
          "landmarks": [...],     // 33 landmarks from MediaPipe
          "timestamp": 123456789
        },
        ...
      ]
    }

── Output ──────────────────────────────────────────────────────────────────
  ./data/X.npy  → Feature matrix (n_samples, 15)
  ./data/y.npy  → Activity labels (n_samples,)
"""

import numpy as np
import json
import glob
from pathlib import Path
from collections import defaultdict

# ── Configuration ──────────────────────────────────────────────────────────
ACTIVITY_NAMES = [
    'Walking',
    'Sitting / rest',
    'Sleeping',
    'Eating',
    'Drinking'
]

# MediaPipe BlazePose 33-landmark indices
# https://google.github.io/mediapipe/solutions/pose.html
NOSE = 0
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_EYE = 1
RIGHT_EYE = 2
MOUTH_LEFT = 9
MOUTH_RIGHT = 10

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / 'data'

# ── Calculate angle between three points ────────────────────────────────────
def angle_between(p1, p2, p3, confidence_threshold=0.3):
    """
    Calculate angle at p2 formed by p1-p2-p3.
    Returns angle in degrees, or None if any point is below confidence threshold.
    
    p1, p2, p3: [x, y, confidence]
    """
    if p1[2] < confidence_threshold or p2[2] < confidence_threshold or p3[2] < confidence_threshold:
        return None
    
    # Vectors from p2 to p1 and p2 to p3
    v1 = np.array([p1[0] - p2[0], p1[1] - p2[1]])
    v2 = np.array([p3[0] - p2[0], p3[1] - p2[1]])
    
    # Magnitudes
    mag1 = np.linalg.norm(v1)
    mag2 = np.linalg.norm(v2)
    
    if mag1 < 1e-6 or mag2 < 1e-6:
        return None
    
    # Cosine similarity
    cos_angle = np.dot(v1, v2) / (mag1 * mag2)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    
    angle_rad = np.arccos(cos_angle)
    angle_deg = np.degrees(angle_rad)
    
    return angle_deg

# ── Distance between two points ────────────────────────────────────────────
def distance(p1, p2, confidence_threshold=0.3):
    """Calculate Euclidean distance between two points."""
    if p1[2] < confidence_threshold or p2[2] < confidence_threshold:
        return None
    
    return np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

# ── Extract 15 features from landmarks ────────────────────────────────────
def extract_features(landmarks):
    """
    Extract 15 features from 33 MediaPipe landmarks.
    This must match the feature extraction in activityDetection.js.
    
    Features:
      0: shoulder_angle
      1: elbow_angle_left
      2: elbow_angle_right
      3: hip_angle
      4: knee_angle_left
      5: ankle_angle (or hip fallback)
      6: arm_raise_left
      7: arm_raise_right
      8: hand_to_mouth
      9: hand_to_face
     10: arm_velocity (change in arm position)
     11: leg_velocity (change in leg position)
     12: torso_lean
     13: body_symmetry
     14: hand_height
    """
    features = []
    
    # Ensure we have exactly 33 landmarks with (x, y, confidence)
    if len(landmarks) != 33 or len(landmarks[0]) < 3:
        return None
    
    landmarks = np.array(landmarks)
    
    try:
        # 0. Shoulder angle (left shoulder - nose - right shoulder)
        shoulder_angle = angle_between(landmarks[LEFT_SHOULDER], landmarks[NOSE], landmarks[RIGHT_SHOULDER])
        features.append(shoulder_angle if shoulder_angle is not None else 0.0)
        
        # 1. Elbow angle left (shoulder - elbow - wrist)
        elbow_left = angle_between(landmarks[LEFT_SHOULDER], landmarks[LEFT_ELBOW], landmarks[LEFT_WRIST])
        features.append(elbow_left if elbow_left is not None else 0.0)
        
        # 2. Elbow angle right
        elbow_right = angle_between(landmarks[RIGHT_SHOULDER], landmarks[RIGHT_ELBOW], landmarks[RIGHT_WRIST])
        features.append(elbow_right if elbow_right is not None else 0.0)
        
        # 3. Hip angle (left hip - nose - right hip)
        hip_angle = angle_between(landmarks[LEFT_HIP], landmarks[NOSE], landmarks[RIGHT_HIP])
        features.append(hip_angle if hip_angle is not None else 0.0)
        
        # 4. Knee angle left (hip - knee - ankle)
        knee_left = angle_between(landmarks[LEFT_HIP], landmarks[LEFT_KNEE], landmarks[LEFT_ANKLE])
        features.append(knee_left if knee_left is not None else 0.0)
        
        # 5. Knee angle right
        knee_right = angle_between(landmarks[RIGHT_HIP], landmarks[RIGHT_KNEE], landmarks[RIGHT_ANKLE])
        features.append(knee_right if knee_right is not None else 0.0)
        
        # 6. Arm raise left (shoulder to wrist vertical distance, normalized by torso length)
        arm_raise_left = landmarks[LEFT_SHOULDER][1] - landmarks[LEFT_WRIST][1]
        features.append(max(0.0, arm_raise_left))  # positive = arm raised
        
        # 7. Arm raise right
        arm_raise_right = landmarks[RIGHT_SHOULDER][1] - landmarks[RIGHT_WRIST][1]
        features.append(max(0.0, arm_raise_right))
        
        # 8. Hand to mouth distance (averaged)
        mouth_center = [
            (landmarks[MOUTH_LEFT][0] + landmarks[MOUTH_RIGHT][0]) / 2,
            (landmarks[MOUTH_LEFT][1] + landmarks[MOUTH_RIGHT][1]) / 2,
            min(landmarks[MOUTH_LEFT][2], landmarks[MOUTH_RIGHT][2])
        ]
        hand_to_mouth_left = distance(landmarks[LEFT_WRIST], mouth_center)
        hand_to_mouth_right = distance(landmarks[RIGHT_WRIST], mouth_center)
        hand_to_mouth = (hand_to_mouth_left if hand_to_mouth_left is not None else 999.0) + \
                       (hand_to_mouth_right if hand_to_mouth_right is not None else 999.0)
        features.append(hand_to_mouth)
        
        # 9. Hand to face distance (eye center to hand)
        eye_center = [
            (landmarks[LEFT_EYE][0] + landmarks[RIGHT_EYE][0]) / 2,
            (landmarks[LEFT_EYE][1] + landmarks[RIGHT_EYE][1]) / 2,
            min(landmarks[LEFT_EYE][2], landmarks[RIGHT_EYE][2])
        ]
        hand_to_face_left = distance(landmarks[LEFT_WRIST], eye_center)
        hand_to_face_right = distance(landmarks[RIGHT_WRIST], eye_center)
        hand_to_face = (hand_to_face_left if hand_to_face_left is not None else 999.0) + \
                      (hand_to_face_right if hand_to_face_right is not None else 999.0)
        features.append(hand_to_face)
        
        # 10. Arm velocity (magnitude of arm position change)
        arm_velocity = abs(landmarks[LEFT_WRIST][0] - landmarks[RIGHT_WRIST][0]) + \
                      abs(landmarks[LEFT_WRIST][1] - landmarks[RIGHT_WRIST][1])
        features.append(arm_velocity)
        
        # 11. Leg velocity (magnitude of leg position change)
        leg_velocity = abs(landmarks[LEFT_ANKLE][0] - landmarks[RIGHT_ANKLE][0]) + \
                      abs(landmarks[LEFT_ANKLE][1] - landmarks[RIGHT_ANKLE][1])
        features.append(leg_velocity)
        
        # 12. Torso lean (horizontal distance between shoulders vs hips)
        shoulder_x_dist = abs(landmarks[LEFT_SHOULDER][0] - landmarks[RIGHT_SHOULDER][0])
        hip_x_dist = abs(landmarks[LEFT_HIP][0] - landmarks[RIGHT_HIP][0])
        torso_lean = shoulder_x_dist - hip_x_dist
        features.append(torso_lean)
        
        # 13. Body symmetry (left-right difference in arm angles)
        body_symmetry = abs(elbow_left if elbow_left is not None else 0.0) - \
                       (elbow_right if elbow_right is not None else 0.0)
        features.append(body_symmetry)
        
        # 14. Hand height (average hand y-position, lower value = higher in frame)
        hand_height = (landmarks[LEFT_WRIST][1] + landmarks[RIGHT_WRIST][1]) / 2
        features.append(hand_height)
        
        return np.array(features, dtype=np.float32)
    
    except Exception as e:
        print(f"Error extracting features: {e}")
        return None

# ── Load and preprocess all sessions ────────────────────────────────────────
def load_and_preprocess():
    """Load all har_session_*.json files and extract features"""
    print("── Loading and preprocessing data ──")
    
    X_list = []
    y_list = []
    activity_counts = defaultdict(int)
    
    session_files = sorted(glob.glob(str(DATA_DIR / 'har_session_*.json')))
    
    if not session_files:
        raise FileNotFoundError(
            f"No har_session_*.json files found in {DATA_DIR}.\n"
            f"Please export sessions from DataCollector.jsx into this directory."
        )
    
    print(f"Found {len(session_files)} session file(s)")
    
    for session_file in session_files:
        print(f"  Loading {Path(session_file).name}...", end=" ")
        
        try:
            with open(session_file, 'r') as f:
                data = json.load(f)
            
            frames = data.get('frames', [])
            frame_count = 0
            
            for frame in frames:
                activity = frame.get('activity')
                landmarks = frame.get('landmarks')
                
                if activity not in ACTIVITY_NAMES:
                    continue
                
                if landmarks is None:
                    continue
                
                features = extract_features(landmarks)
                if features is not None:
                    X_list.append(features)
                    y_list.append(ACTIVITY_NAMES.index(activity))
                    activity_counts[activity] += 1
                    frame_count += 1
            
            print(f"{frame_count} frames")
        
        except Exception as e:
            print(f"Error: {e}")
            continue
    
    if not X_list:
        raise ValueError("No valid training data could be extracted.")
    
    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)
    
    print(f"\n✓ Loaded {len(X)} samples")
    print(f"  Activity distribution:")
    for activity, count in sorted(activity_counts.items()):
        print(f"    {activity}: {count}")
    
    return X, y

# ── Save data ──────────────────────────────────────────────────────────────
def save_data(X, y):
    """Save X and y as numpy files"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    X_path = DATA_DIR / 'X.npy'
    y_path = DATA_DIR / 'y.npy'
    
    np.save(X_path, X)
    np.save(y_path, y)
    
    print(f"✓ Saved X to {X_path}")
    print(f"✓ Saved y to {y_path}")

# ── Main ────────────────────────────────────────────────────────────────────
def main():
    print("=" * 80)
    print("Random Forest HAR Data Preprocessing")
    print("=" * 80)
    
    try:
        X, y = load_and_preprocess()
        save_data(X, y)
        
        print("\n" + "=" * 80)
        print("✓ Preprocessing complete!")
        print("=" * 80)
        print(f"\nNext step: run train_rf_model.py")
    
    except Exception as e:
        print(f"\n✗ Error: {e}")
        exit(1)

if __name__ == '__main__':
    main()
