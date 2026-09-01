# Quick Start: Random Forest Activity Detection

Get the Random Forest model up and running in 5 minutes.

## Prerequisites

- Python 3.8+
- Training data: `har_session_*.json` files from DataCollector
- Backend running: `python schedule-monitoring/backend/run.py`
- Frontend running: `npm run dev` in `schedule-monitoring/frontend`

## Quick Steps

### 1. Collect & Preprocess Data (2-3 min)

```bash
cd schedule-monitoring/training

# Make sure har_session_*.json files are in ./data/
ls -la data/

# Preprocess
python preprocess_rf_data.py
```

Expected output:
```
✓ Loaded 1000 samples
✓ Saved X to ./data/X.npy
✓ Saved y to ./data/y.npy
```

### 2. Train Model (1-2 min)

```bash
python train_rf_model.py
```

Expected output:
```
✓ Trained Random Forest
✓ Overall Accuracy: 0.87

Next steps:
  1. Copy output/rf_model.pkl to backend/app/models/
  2. Copy output/rf_model_stats.json to backend/app/models/
  3. Restart backend
```

### 3. Deploy to Backend (1 min)

```bash
# Copy model files
cp output/rf_model.pkl ../backend/app/models/
cp output/rf_model_stats.json ../backend/app/models/

# Check files exist
ls -la ../backend/app/models/rf_*
```

### 4. Restart Backend

```bash
# Terminal where backend is running
# Press Ctrl+C to stop
# Then restart:
cd schedule-monitoring/backend
pip install -r requirements.txt
python run.py
```

Check logs for:
```
✓ Loaded RF model from app/models/rf_model.pkl
✓ Loaded normalization stats from app/models/rf_model_stats.json
```

### 5. Enable in Frontend

Edit `schedule-monitoring/frontend/src/services/activityDetection.js`:

```javascript
const USE_LSTM = false;  // ← Change to false
const USE_RF = true;     // ← Change to true
```

Frontend will auto-reload. Check browser console for:
```
RF: Predicted: Walking (confidence: 0.87)
```

## Verify It Works

### Test via API

```bash
curl -X POST http://localhost:8004/api/monitoring/predict-rf \
  -H "Content-Type: application/json" \
  -d '{"features": [95.5, 120.3, 115.8, 170.2, 155.3, 152.1, 0.05, 0.08, 0.15, 0.22, 0.032, 0.018, 5.2, 2.1, 0.45]}'

# Response:
# {"activity":"Walking","confidence":0.87,"model_ready":true}
```

### Test via Frontend

1. Open browser at `http://localhost:5173/schedule/monitoring`
2. Start moving (walk, sit, etc.)
3. Look for predictions in browser console (F12 → Console)
4. Check `activity_name` displayed on page

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Model not loaded" | Copy model files to `backend/app/models/` |
| "No module named sklearn" | `pip install scikit-learn joblib` |
| No predictions | Check `USE_RF = true` in activityDetection.js |
| Wrong predictions | Check training data quality or collect more data |
| Slow predictions | Check backend is running; consider disabling face detection |

## What's Happening

```
You (doing activities) 
    ↓
Camera feed
    ↓
MediaPipe Pose (33 landmarks)
    ↓
extractRFFeatures() (15 features)
    ↓
POST /api/monitoring/predict-rf
    ↓
Backend ActivityService.predict_activity()
    ↓
Random Forest model predicts activity
    ↓
Frontend receives prediction
    ↓
onActivityCallback() updates UI
```

## Next: Fine-Tuning (Optional)

Want better accuracy? See [README_RF.md](./README_RF.md#retraining) for advanced steps.

## Key Files

- `train_rf_model.py` — Training script
- `preprocess_rf_data.py` — Data preparation
- `backend/app/services/activity_service.py` — Prediction service
- `frontend/src/services/activityDetection.js` — Frontend integration

---

**All done!** Your Random Forest model is live. 🎉
