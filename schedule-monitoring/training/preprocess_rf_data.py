#!/usr/bin/env python3
"""
preprocess_rf_data.py

Preprocesses har_session_*.json exported files into X.npy and y.npy
with 15 engineered pose features matching activityDetection.js.
"""

import numpy as np
import json
import glob
from pathlib import Path
from collections import defaultdict

ACTIVITY_NAMES = [
    'Walking',
    'Sitting / rest',
    'Sleeping',
    'Eating',
    'Drinking'
]

# MediaPipe BlazePose 33 Landmarks
NOSE = 0
LEFT_EYE = 1
RIGHT_EYE = 2
MOUTH_LEFT = 9
MOUTH_RIGHT = 10
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

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / 'data'

def angle_between(p1, p2, p3, confidence_threshold=0.3):
    if p1[2] < confidence_threshold or p2[2] < confidence_threshold or p3[2] < confidence_threshold:
        return 0.0
    v1 = np.array([p1[0] - p2[0], p1[1] - p2[1]])
    v2 = np.array([p3[0] - p2[0], p3[1] - p2[1]])
    mag1 = np.linalg.norm(v1)
    mag2 = np.linalg.norm(v2)
    if mag1 < 1e-6 or mag2 < 1e-6:
        return 0.0
    cos_angle = np.clip(np.dot(v1, v2) / (mag1 * mag2), -1.0, 1.0)
    return np.degrees(np.arccos(cos_angle))

def distance(p1, p2, confidence_threshold=0.3):
    if p1[2] < confidence_threshold or p2[2] < confidence_threshold:
        return 999.0
    return float(np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2))

def extract_features(landmarks):
    if len(landmarks) != 33 or len(landmarks[0]) < 3:
        return None

    landmarks = np.array(landmarks)
    features = []

    try:
        # 0: Shoulder Angle
        features.append(angle_between(landmarks[LEFT_SHOULDER], landmarks[NOSE], landmarks[RIGHT_SHOULDER]))
        # 1: Left Elbow Angle
        features.append(angle_between(landmarks[LEFT_SHOULDER], landmarks[LEFT_ELBOW], landmarks[LEFT_WRIST]))
        # 2: Right Elbow Angle
        features.append(angle_between(landmarks[RIGHT_SHOULDER], landmarks[RIGHT_ELBOW], landmarks[RIGHT_WRIST]))
        # 3: Hip Angle
        features.append(angle_between(landmarks[LEFT_HIP], landmarks[NOSE], landmarks[RIGHT_HIP]))
        # 4: Left Knee Angle
        features.append(angle_between(landmarks[LEFT_HIP], landmarks[LEFT_KNEE], landmarks[LEFT_ANKLE]))
        # 5: Right Knee Angle
        features.append(angle_between(landmarks[RIGHT_HIP], landmarks[RIGHT_KNEE], landmarks[RIGHT_ANKLE]))

        # 6-7: Arm Raise Left/Right
        features.append(max(0.0, float(landmarks[LEFT_SHOULDER][1] - landmarks[LEFT_WRIST][1])))
        features.append(max(0.0, float(landmarks[RIGHT_SHOULDER][1] - landmarks[RIGHT_WRIST][1])))

        # 8: Hand to Mouth
        mouth_center = [
            (landmarks[MOUTH_LEFT][0] + landmarks[MOUTH_RIGHT][0]) / 2,
            (landmarks[MOUTH_LEFT][1] + landmarks[MOUTH_RIGHT][1]) / 2,
            min(landmarks[MOUTH_LEFT][2], landmarks[MOUTH_RIGHT][2])
        ]
        hand_to_mouth = distance(landmarks[LEFT_WRIST], mouth_center) + distance(landmarks[RIGHT_WRIST], mouth_center)
        features.append(hand_to_mouth)

        # 9: Hand to Face
        eye_center = [
            (landmarks[LEFT_EYE][0] + landmarks[RIGHT_EYE][0]) / 2,
            (landmarks[LEFT_EYE][1] + landmarks[RIGHT_EYE][1]) / 2,
            min(landmarks[LEFT_EYE][2], landmarks[RIGHT_EYE][2])
        ]
        hand_to_face = distance(landmarks[LEFT_WRIST], eye_center) + distance(landmarks[RIGHT_WRIST], eye_center)
        features.append(hand_to_face)

        # 10: Arm Velocity / Spread
        features.append(abs(float(landmarks[LEFT_WRIST][0] - landmarks[RIGHT_WRIST][0])) + abs(float(landmarks[LEFT_WRIST][1] - landmarks[RIGHT_WRIST][1])))
        # 11: Leg Velocity / Spread
        features.append(abs(float(landmarks[LEFT_ANKLE][0] - landmarks[RIGHT_ANKLE][0])) + abs(float(landmarks[LEFT_ANKLE][1] - landmarks[RIGHT_ANKLE][1])))
        # 12: Torso Lean
        features.append(abs(float(landmarks[LEFT_SHOULDER][0] - landmarks[RIGHT_SHOULDER][0])) - abs(float(landmarks[LEFT_HIP][0] - landmarks[RIGHT_HIP][0])))
        # 13: Body Symmetry
        left_elbow = angle_between(landmarks[LEFT_SHOULDER], landmarks[LEFT_ELBOW], landmarks[LEFT_WRIST])
        right_elbow = angle_between(landmarks[RIGHT_SHOULDER], landmarks[RIGHT_ELBOW], landmarks[RIGHT_WRIST])
        features.append(abs(left_elbow - right_elbow))
        # 14: Hand Height
        features.append(float((landmarks[LEFT_WRIST][1] + landmarks[RIGHT_WRIST][1]) / 2))

        return np.array(features, dtype=np.float32)

    except Exception as e:
        print(f"Extraction error: {e}")
        return None

def main():
    X_list, y_list = [], []
    session_files = sorted(glob.glob(str(DATA_DIR / 'har_session_*.json')))

    if not session_files:
        print(f"No session files found in {DATA_DIR}")
        return

    for session_file in session_files:
        with open(session_file, 'r') as f:
            data = json.load(f)
        frames = data.get('frames', []) if isinstance(data, dict) else data

        for frame in frames:
            activity = frame.get('activity') or frame.get('label')
            landmarks = frame.get('landmarks')
            if activity in ACTIVITY_NAMES and landmarks and len(landmarks) == 33:
                feats = extract_features(landmarks)
                if feats is not None:
                    X_list.append(feats)
                    y_list.append(ACTIVITY_NAMES.index(activity))

    if not X_list:
        print("No training data extracted.")
        return

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)

    np.save(DATA_DIR / 'X.npy', X)
    np.save(DATA_DIR / 'y.npy', y)
    print(f"✓ Saved X: {X.shape}, y: {y.shape} to {DATA_DIR}")

if __name__ == '__main__':
    main()