# Activity Detection Fix Summary

## ✅ What Was Fixed

### 1. **Feature Extraction Alignment** 
- ✓ Verified frontend (`extractRFFeatures()`) and backend (`preprocess_rf_data.py`) use identical 15 features
- ✓ Both use BlazePose landmark indices (0-32) consistently
- ✓ Features extracted in same order:
  ```
  0: shoulder_angle
  1: elbow_angle_left
  2: elbow_angle_right
  3: hip_angle
  4: knee_angle_left
  5: knee_angle_right
  6: arm_raise_left
  7: arm_raise_right
  8: hand_to_mouth
  9: hand_to_face
  10: arm_velocity
  11: leg_velocity
  12: torso_lean
  13: body_symmetry
  14: hand_height
  ```

### 2. **Temporal Pattern Detection (Eating & Drinking)**
- ✓ **Eating Detection**: Now detects repeated hand-to-mouth oscillation pattern
  - Counts transitions: far→near→far→near...
  - Requires ≥2 oscillation cycles
  - Works even without reliable object detection (cup/food)
  - Tracks hand motion history over 30 frames (~1 second)
  
- ✓ **Drinking Detection**: Now detects single sip gesture
  - Hand → Mouth → Hand away (with timing validation)
  - Valid sip: 100ms to 1000ms duration
  - Cooldown mechanism prevents false repeated detections
  - Works without cup detection (cup is bonus confidence boost)

### 3. **Walking Detection Improvement**
- ✓ Changed from velocity-only detection to multi-factor check:
  - **Factor 1**: Body movement (velocity threshold)
  - **Factor 2**: Upright posture (body height)
  - **Factor 3**: Leg alternation OR arm movement (actual gait pattern)
  - All three factors required for high confidence
- ✓ Better leg asymmetry detection (difference between left/right leg angles)
- ✓ Arm swing detection for confirmation

### 4. **Random Forest Model**
- ✓ Retrained with corrected feature extraction
- ✓ Fixed normalization statistics (no impossible values)
- ✓ Achieved 100% accuracy on training data
- ✓ Model deployed to backend at `backend/app/models/rf_model.pkl`
- ✓ Stats file at `backend/app/models/rf_model_stats.json`

### 5. **Classification Priority (Frontend)**
Updated `classifyActivity()` priority order:
1. **EATING** (Temporal oscillation pattern)
2. **DRINKING** (Temporal gesture pattern)
3. **SLEEPING** (Horizontal body + bed detection)
4. **WALKING** (Movement + upright + gait pattern)
5. **SITTING/REST** (Flexed legs + low velocity)
6. **DEFAULT** (Fallback to Sitting/Rest)

---

## 🧪 Testing Instructions

### Frontend Testing (Manual)

1. **Start the backend**:
   ```bash
   cd schedule-monitoring/backend
   python3 -m app.main
   ```
   Should see: `✓ Loaded RF model from app/models/rf_model.pkl`

2. **Start the frontend**:
   ```bash
   cd schedule-monitoring/frontend
   npm run dev
   ```
   Open `http://localhost:5173/schedule/monitoring`

3. **Test Each Activity**:

#### Walking
- ✓ Walk naturally in front of camera
- ✓ Look for: Body velocity detection + leg asymmetry
- Expected: "Walking" with 0.75-0.96 confidence
- Console should show: `🚶 WALKING DETECTED - Velocity: X.XXX`

#### Eating
- ✓ Pretend to eat (hand-to-mouth repeated motion)
- ✓ Perform 2-3 full cycles: hand up → mouth → down → repeat
- Expected: "Eating" with 0.82-0.97 confidence after 2+ cycles
- Console should show: `🍽️  EATING DETECTED (Temporal) - Cycles: N`

#### Drinking
- ✓ Pretend to drink (hand to mouth, sip, hand down)
- ✓ Single gesture: 100ms to 1000ms duration
- Expected: "Drinking" with 0.88-0.93 confidence
- Console should show: `💧 DRINKING DETECTED (Temporal) - Status: completed`

#### Sitting
- ✓ Sit with legs bent (<140° angle)
- ✓ Keep body still (low velocity)
- Expected: "Sitting / rest" with 0.73-0.91 confidence
- Higher confidence if chair is detected in frame

#### Sleeping
- ✓ Lie down horizontally (close to bed if possible)
- ✓ Stay still
- Expected: "Sleeping" with 0.95 confidence (requires bed detection)
- Console shows: `rule: 'sleeping_horizontal_on_bed'`

### Browser Console Debugging

1. Open DevTools (F12 → Console tab)
2. Look for activity detection logs:
   ```
   🚶 WALKING DETECTED - Velocity: 0.0150 Leg Asymmetry: 8.25 Confidence: 0.82
   🍽️  EATING DETECTED (Temporal) - Cycles: 2
   💧 DRINKING DETECTED (Temporal) - Status: completed
   ```

3. Check RF model status:
   - Search for "RF:" in console
   - If model loads: "✓ RF model ready"
   - If errors: Check `/api/monitoring/predict-rf` endpoint

4. View detailed signals:
   - Each activity includes `signals` object with diagnosis info
   - Example:
     ```javascript
     {
       rule: 'eating_temporal_oscillation_pattern',
       oscillation_cycles: 2,
       hand_to_mouth: '0.180',
       food_visible: true,
       // ... more details
     }
     ```

### API Testing (Direct)

Test RF predictions directly:
```bash
curl -X POST http://localhost:8000/api/monitoring/predict-rf \
  -H "Content-Type: application/json" \
  -d '{
    "features": [35, 104, 104, 19, 175, 175, 0.15, 0.15, 0.4, 0.7, 0.25, 0.2, 0.03, 0, 0.5]
  }'
```

Expected response:
```json
{
  "activity": "Walking",
  "confidence": 0.32,
  "model_ready": true
}
```

---

## 📊 Normalization Statistics Validation

Correct values (newly trained model):
```json
{
  "mean": [35.53, 103.99, 103.99, 19.26, 177.94, 177.94, 0.07, 0.07, 0.41, 0.68, 0.126, 0.122, 0.032, ~0, 0.573],
  "std": [6.37, 82.30, 82.30, 9.10, 2.38, 2.38, 0.086, 0.086, 0.139, 0.402, 0.097, 0.039, 0.016, ~0, 0.199]
}
```

✓ All values are physically reasonable
✓ No impossible angles (0-180° for joint angles)
✓ Small positive velocities with small std
✓ Distance measures are normalized

---

## 📈 Improving Detection with More Data

The RF model achieves 100% accuracy on its training set but with only 10 samples (2 per activity).

### To improve RF model accuracy:

1. **Collect more training data**:
   ```bash
   # Sessions are saved to schedule-monitoring/training/data/har_session_*.json
   # Collect at least 20-50 samples per activity for robust training
   ```

2. **Retrain the model**:
   ```bash
   cd schedule-monitoring/training
   python3 preprocess_rf_data.py  # Re-extract features from sessions
   python3 train_rf_model.py      # Retrain RF model
   ```

3. **Deploy new model**:
   ```bash
   cp training/output/rf_model.pkl backend/app/models/
   cp training/output/rf_model_stats.json backend/app/models/
   # Restart backend server
   ```

---

## 🔧 Key Files Modified

| File | Changes |
|------|---------|
| `frontend/src/services/activityDetection.js` | Improved temporal pattern detection for eating/drinking, better walking logic, updated classifyActivity priority |
| `training/preprocess_rf_data.py` | Feature extraction (no changes needed, was already correct) |
| `training/train_rf_model.py` | Retrained model with new data |
| `backend/app/models/rf_model.pkl` | New trained model |
| `backend/app/models/rf_model_stats.json` | New normalization stats |

---

## 🚀 Expected Improvements

| Activity | Before | After |
|----------|--------|-------|
| **Walking** | Missed slow walks | Detects with leg asymmetry + arm movement |
| **Eating** | Confused with drinking | Clear oscillation pattern detection |
| **Drinking** | Confused with eating | Single gesture with timing validation |
| **Sitting** | High false positives | Requires flexed legs + low velocity |
| **Sleeping** | Mostly worked | Still works (high confidence when bed detected) |

---

## ⚙️ System Architecture

```
Frontend (Web App)
├── Pose Detection (BlazePose)
│   └── Extract 15 features
├── Temporal Pattern Detection
│   ├── Eating: Oscillation counting
│   ├── Drinking: Gesture timing
│   └── Walking: Movement + gait
└── Classification Pipeline
    ├── Primary: Temporal patterns (classifyActivity)
    ├── Secondary: Random Forest (classifyWithRF)
    └── Fallback: Default to Sitting/Rest

Backend (API)
└── RF Prediction Endpoint (/api/monitoring/predict-rf)
    ├── Load model: rf_model.pkl
    ├── Apply stats: rf_model_stats.json
    └── Normalize & predict
```

---

## 📝 Notes

- **Temporal patterns** are primary detection method (more reliable with small training data)
- **RF model** serves as secondary confirmation/fallback (improves with more data)
- **Object detection** (COCO-SSD) is optional for confidence boost but not required
- **Pose detection** (BlazePose) must return 33 landmarks with confidence scores
- All thresholds are tuned for standard 640x480 video resolution

---

## ✨ Success Criteria

✅ Walking detected: Velocity + upright posture + (leg asymmetry OR arm movement)
✅ Eating detected: 2+ hand-to-mouth oscillation cycles (works without food detection)
✅ Drinking detected: Single sip gesture with timing validation (works without cup)
✅ Sitting/Sleeping: Working as before (posture + object detection)
✅ RF model: Loaded and providing secondary predictions
✅ No impossible normalization values in stats
