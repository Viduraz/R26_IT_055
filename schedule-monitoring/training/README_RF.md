# Random Forest Activity Detection System

This document explains how to train and deploy the **Random Forest (RF)** model for activity detection in the schedule-monitoring system.

## Overview

The Random Forest model is an alternative to LSTM that provides:
- ✅ **No LSTM conflicts** — Uses scikit-learn, not TensorFlow
- ✅ **High accuracy** — ~80-95% depending on training data quality
- ✅ **Fast predictions** — Runs on the backend, no browser computational burden
- ✅ **5 activities** — Walking, Sitting/rest, Sleeping, Eating, Drinking

## Architecture

```
┌─ Frontend (schedule-monitoring/frontend) ──────┐
│  extractRFFeatures(keypoints) → 15 features   │
│  POST /api/monitoring/predict-rf               │
└─────────────────┬────────────────────────────┘
                  │
┌─ Backend (schedule-monitoring/backend) ────────┐
│  ActivityService.predict_activity()            │
│  Loads: app/models/rf_model.pkl                │
│  Stats: app/models/rf_model_stats.json         │
└──────────────────────────────────────────────┘
```

## Step 1: Collect Training Data

### Using DataCollector.jsx

1. Open the frontend at `http://localhost:5173/schedule/data-collector`
2. For each activity (Walking, Sitting, Sleeping, Eating, Drinking):
   - Record **1-2 minutes** of video
   - Export the session as `har_session_*.json`
3. Total: ~10 minutes of data (5 activities × 2 minutes)

### Expected Output

Each `har_session_*.json` file contains:

```json
{
  "frames": [
    {
      "activity": "Walking",
      "landmarks": [[x, y, confidence], [...], ...],  // 33 landmarks
      "timestamp": 1234567890
    },
    ...
  ]
}
```

## Step 2: Preprocess Data

Place all `har_session_*.json` files in `schedule-monitoring/training/data/`, then:

```bash
cd /path/to/R26_IT_055/schedule-monitoring/training
python preprocess_rf_data.py
```

### Output

- `data/X.npy` — Feature matrix (n_samples, 15 features)
- `data/y.npy` — Activity labels (n_samples,)

### Features Extracted

| Index | Feature           | Description                        |
|-------|-------------------|------------------------------------|
| 0     | shoulder_angle    | Angle at nose between shoulders    |
| 1     | elbow_angle_left  | Left shoulder-elbow-wrist angle    |
| 2     | elbow_angle_right | Right shoulder-elbow-wrist angle   |
| 3     | hip_angle         | Angle at nose between hips         |
| 4     | knee_angle_left   | Left hip-knee-ankle angle          |
| 5     | knee_angle_right  | Right hip-knee-ankle angle         |
| 6     | arm_raise_left    | Left shoulder→wrist vertical dist  |
| 7     | arm_raise_right   | Right shoulder→wrist vertical dist |
| 8     | hand_to_mouth     | Hand distance to mouth (summed)    |
| 9     | hand_to_face      | Hand distance to face (summed)     |
| 10    | arm_velocity      | Horizontal + vertical hand movement|
| 11    | leg_velocity      | Horizontal + vertical ankle movement|
| 12    | torso_lean        | Shoulder width − hip width         |
| 13    | body_symmetry     | Difference in left/right arm angles|
| 14    | hand_height       | Average hand y-position (lower=higher)|

## Step 3: Train the Model

```bash
cd /path/to/R26_IT_055/schedule-monitoring/training
python train_rf_model.py
```

### Configuration

Edit `train_rf_model.py` to adjust hyperparameters:

```python
RF_N_ESTIMATORS = 100        # Number of trees
RF_MAX_DEPTH = 15            # Max tree depth
RF_MIN_SAMPLES_SPLIT = 5     # Min samples to split
RF_MIN_SAMPLES_LEAF = 2      # Min samples in leaf
RF_RANDOM_STATE = 42         # Reproducibility
```

### Output

```
output/rf_model.pkl            — Trained model (binary)
output/rf_model_stats.json     — Normalization stats
```

### Example Output

```
✓ Loaded X: (1000, 15), y: (1000,)

── Training Random Forest ──
  n_estimators: 100
  max_depth: 15
  ...

── Evaluating Random Forest ──
  Overall Accuracy: 0.8725
  
  Classification Report:
                precision    recall  f1-score   support
        Walking       0.92      0.88      0.90       180
    Sitting / rest   0.87      0.89      0.88       210
        Sleeping     0.95      0.93      0.94       150
          Eating     0.82      0.85      0.83       170
        Drinking     0.79      0.81      0.80       140
```

## Step 4: Deploy to Backend

### Copy Model Files

```bash
# From training directory to backend
cp schedule-monitoring/training/output/rf_model.pkl \
   schedule-monitoring/backend/app/models/

cp schedule-monitoring/training/output/rf_model_stats.json \
   schedule-monitoring/backend/app/models/
```

### Install Dependencies

```bash
cd schedule-monitoring/backend
pip install -r requirements.txt
```

This installs:
- `scikit-learn==1.4.1`
- `joblib==1.3.2`

### Restart Backend

```bash
cd schedule-monitoring/backend
python run.py
```

You should see:
```
✓ Loaded RF model from app/models/rf_model.pkl
✓ Loaded normalization stats from app/models/rf_model_stats.json
```

## Step 5: Enable in Frontend

Edit [schedule-monitoring/frontend/src/services/activityDetection.js](../../frontend/src/services/activityDetection.js#L39):

```javascript
const USE_LSTM = false;  // Disable LSTM
const USE_RF = true;     // Enable Random Forest
```

Or keep both false to use the threshold-based classifier as fallback.

## Step 6: Test the System

1. Open `http://localhost:5173/schedule/monitoring` in the browser
2. Verify console logs show RF predictions:
   ```
   RF: Predicted: Walking (confidence: 0.85)
   ```
3. Expected activities should be detected correctly

## Monitoring & Debugging

### Backend Logs

Check for model loading at startup:
```bash
tail -f logs/backend.log | grep -i "model\|rf"
```

### Frontend Console

```javascript
// Open DevTools → Console
// You should see:
RF: Predicted: Walking (confidence: 0.85)
RF: Predicted: Eating (confidence: 0.92)
```

### API Test

```bash
curl -X POST http://localhost:8004/api/monitoring/predict-rf \
  -H "Content-Type: application/json" \
  -d '{
    "features": [95.5, 120.3, 115.8, 170.2, 155.3, 152.1, 0.05, 0.08, 0.15, 0.22, 0.032, 0.018, 5.2, 2.1, 0.45]
  }'
```

Response:
```json
{
  "activity": "Walking",
  "confidence": 0.87,
  "model_ready": true
}
```

## Fallback Behavior

### Confidence Thresholds

- **RF confidence < 0.55** → Falls back to threshold classifier
- **LSTM confidence < 0.55** → Falls back to threshold classifier
- **Threshold classifier** → Always returns a result (minimum confidence = 0.55)

### Priority Order

1. **Random Forest** (if `USE_RF = true`)
   - Returns high-confidence predictions directly
   - Falls back to threshold classifier if uncertain

2. **LSTM** (if `USE_LSTM = true` and `USE_RF = false`)
   - Returns high-confidence predictions directly
   - Falls back to threshold classifier if uncertain

3. **Threshold Classifier** (fallback)
   - Uses hand-to-face distance, body posture, object detection
   - Always provides a prediction (confidence >= 0.55)

## Retraining

To improve accuracy:

1. **Collect more data**
   - Aim for 100+ samples per activity
   - Vary lighting, camera angles, clothing

2. **Adjust hyperparameters**
   - Increase `RF_N_ESTIMATORS` (e.g., 200)
   - Reduce `RF_MAX_DEPTH` to prevent overfitting
   - Increase `RF_MIN_SAMPLES_LEAF` for regularization

3. **Validate with different populations**
   - Test on multiple people if possible
   - Account for variations in body size/shape

## Troubleshooting

### Model Not Found

**Error**: `Model not loaded. Ensure rf_model.pkl is in app/models/`

**Solution**:
```bash
# Check file exists
ls -la schedule-monitoring/backend/app/models/rf_model.pkl

# Copy if missing
cp schedule-monitoring/training/output/rf_model.pkl \
   schedule-monitoring/backend/app/models/
```

### Low Accuracy

**Problem**: Predictions are incorrect

**Solution**:
1. Check training data quality
   - Verify activities are correctly labeled
   - Ensure good pose detection (high keypoint confidence)

2. Increase training data
   - Collect more diverse examples

3. Adjust thresholds
   - Lower `LSTM_CONFIDENCE_THRESHOLD` or `RF_CONFIDENCE_THRESHOLD`
   - Increase `SMOOTHING_WINDOW` for more smoothing

### Slow Predictions

**Problem**: Frontend feels sluggish

**Solution**:
1. Reduce `OBJECT_DETECT_EVERY_N_FRAMES` (currently 2)
2. Disable face detection if not needed
3. Check backend CPU usage

## Files

| File                                      | Purpose                              |
|-------------------------------------------|--------------------------------------|
| `training/train_rf_model.py`              | Train script (run once)              |
| `training/preprocess_rf_data.py`          | Data preprocessing                   |
| `backend/app/services/activity_service.py`| RF prediction service                |
| `backend/app/routes/monitoring_routes.py` | `/api/monitoring/predict-rf` endpoint|
| `backend/app/models/rf_model.pkl`         | Trained model (not in repo)          |
| `backend/app/models/rf_model_stats.json`  | Normalization stats (not in repo)    |
| `frontend/src/services/activityDetection.js` | Frontend integration                 |

## Next Steps

- [ ] Collect training data from real users
- [ ] Preprocess with `preprocess_rf_data.py`
- [ ] Train with `train_rf_model.py`
- [ ] Deploy model files to backend
- [ ] Enable `USE_RF = true` in frontend
- [ ] Monitor predictions in production
- [ ] Retrain periodically with new data

## References

- [Random Forest — Scikit-learn Docs](https://scikit-learn.org/stable/modules/ensemble.html#random-forests)
- [MediaPipe Pose — Landmark Indices](https://google.github.io/mediapipe/solutions/pose.html)
- [Pose Feature Extraction — extract_pose_sequences.py](../pipelines/extract_pose_sequences.py)
