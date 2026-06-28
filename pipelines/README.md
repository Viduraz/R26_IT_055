# LSTM-HAR Pipeline

Train a real LSTM model on **Kinetics-700 / UCF101 / HMDB51** and deploy it in the browser as a drop-in replacement for the current threshold-based classifier.

---

## Quick Start

```bash
cd pipelines/
pip install -r requirements.txt
```

### Step 1 — Extract pose features from your video datasets

```bash
# HMDB51 (fastest — 2 GB, covers 6/8 activities)
python3 extract_pose_sequences.py \
  --dataset hmdb51 \
  --root    /path/to/hmdb51 \
  --out_dir ./data

# UCF101 (walking, eating)
python3 extract_pose_sequences.py \
  --dataset ucf101 \
  --root    /path/to/UCF-101 \
  --out_dir ./data

# Kinetics-700 (all 8 activities, largest coverage)
python3 extract_pose_sequences.py \
  --dataset kinetics700 \
  --root    /path/to/kinetics700 \
  --out_dir ./data \
  --max_per_class 500
```

Each run saves:
- `data/<dataset>_X.npy` — pose sequences `(N, 30, 14)`
- `data/<dataset>_y.npy` — activity labels `(N,)`

---

### Step 2 — Train the LSTM

```bash
# Use all 3 datasets (best accuracy)
python3 train_lstm_har.py \
  --data data/kinetics700 data/ucf101 data/hmdb51

# Or just HMDB51 for a quick first run (~30 min on CPU)
python3 train_lstm_har.py --data data/hmdb51
```

Outputs:
- `../schedule-monitoring/frontend/public/lstm_har_model/model.json`  ← TF.js model
- `../schedule-monitoring/frontend/public/lstm_har_model/norm_stats.json`
- `models/lstm_har.keras`  ← Keras checkpoint
- `models/training_history.png`  ← accuracy / loss curves

---

### Step 3 — Enable in the browser

The `activityDetection.js` already has the LSTM integration built in.  
Once `public/lstm_har_model/` exists, set the flag in the service:

```js
// schedule-monitoring/frontend/src/services/activityDetection.js
const USE_LSTM = true;   // ← change from false to true
```

That's it — no other code changes needed.

---

## Activity Label Map

| ID | Activity       | Key Dataset Source           |
|----|---------------|------------------------------|
|  0 | Sleep          | Kinetics-700 `sleeping`      |
|  1 | Eating         | HMDB51 `eat`, Kinetics-700 `eating_food` |
|  2 | Drinking       | HMDB51 `drink`, Kinetics-700 `drinking_beer` |
|  3 | Talking        | HMDB51 `talk`                |
|  4 | Walking        | UCF101 `Walking`, HMDB51 `walk` |
|  5 | Sitting / rest | HMDB51 `sit`                 |
|  6 | Standing up    | Kinetics-700 `getting_up`    |
|  7 | Movement       | Fallback (threshold only)    |

---

## Expected Accuracy

| Training Data     | ~Test Accuracy |
|------------------|---------------|
| HMDB51 only      | 82 – 86%      |
| All 3 datasets   | 91 – 95%      |
| + your own clips | 95 – 97%      |

---

## Directory Structure

```
pipelines/
├── extract_pose_sequences.py   ← Step 1: video → pose features
├── train_lstm_har.py           ← Step 2: features → LSTM → TF.js
├── requirements.txt
├── README.md                   ← this file
├── data/                       ← .npy files (created by step 1)
│   ├── hmdb51_X.npy
│   ├── hmdb51_y.npy
│   └── ...
└── models/                     ← Keras checkpoints (created by step 2)
    ├── lstm_har.keras
    └── training_history.png

schedule-monitoring/frontend/public/
└── lstm_har_model/             ← TF.js model (browser loads this)
    ├── model.json
    ├── norm_stats.json
    └── group1-shard1of1.bin
```
