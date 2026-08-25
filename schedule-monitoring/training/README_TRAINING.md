# Training a real HAR classifier for SecureElder Care

This replaces the hand-tuned threshold rules in `activityDetection.js` with a
small LSTM trained on your own webcam data — using the LSTM loading code
that's *already written* in that file (`LSTM_MODEL_PATH`, `LSTM_STATS_PATH`,
`LSTM_SEQ_LEN`, `LSTM_ACTIVITY_NAMES`, `classifyWithLSTM`). You're filling in
a contract that already exists, not building new plumbing.

## Step 1 — Collect labeled data (1–2 days)

1. Drop `DataCollector.jsx` into `frontend/src/pages/`.
2. Add a route to it (e.g. `/data-collector`) — dev-only, remove before
   shipping if you want.
3. Run it, pick a label, click **Start Recording**, perform that activity
   for 2–3 minutes. Switch labels between activities.
4. Aim for **every one of the 8 activities**: Sleeping, Eating, Drinking,
   Taking Medications, Walking, Sitting / rest, Standing, Movement.
   (Movement/transitions matters too — record some "getting up",
   "turning around", "reaching" clips as generic Movement.)
5. Vary conditions across sessions if you can: different distance from
   camera, different lighting, a second person if available (per your
   answer — you're recording both yourself and a family member, which is
   genuinely good — more variation makes the model generalize better).
6. Click **Export Session** after each recording block — downloads a
   `har_session_<timestamp>.json` file. Do this a few times across
   different sittings rather than one long session.
7. Collect all exported files into one `data/` folder for training.

**Rough target:** a few thousand frames per activity (roughly 2–4 minutes
each at typical webcam frame rates). More is better, but this is enough to
meaningfully beat pure thresholds if your recordings are reasonably clean.

## Step 2 — Train (a few hours, mostly unattended)

```bash
mkdir har-training && cd har-training
npm init -y
npm install @tensorflow/tfjs-node
mkdir data
# copy your har_session_*.json files into ./data
```

Copy `train_har_model.js` into this folder, then:

```bash
node train_har_model.js
```

Watch the console output:
- **Window counts per activity** — if any activity shows 0 or very few
  windows, you need to record more of that one specifically.
- **train_acc vs val_acc** at the end of training — if val_acc is much
  lower than train_acc (e.g. 95% train vs 60% val), the model is
  overfitting and needs more/more varied data, not more epochs.

Output lands in `./output/`: `model.json`, weight `.bin` file(s), and
`norm_stats.json`.

## Step 3 — Integrate (10 minutes)

1. Copy `output/model.json`, `output/*.bin`, and `output/norm_stats.json`
   into your React app's `public/lstm_har_model/` folder (create it if it
   doesn't exist) — paths must match exactly what `activityDetection.js`
   already expects:
   - `/lstm_har_model/model.json`
   - `/lstm_har_model/norm_stats.json`
2. In `activityDetection.js`, change:
   ```js
   const USE_LSTM = false;
   ```
   to:
   ```js
   const USE_LSTM = true;
   ```
3. That's it — no other code changes. `classifyWithLSTM()` already exists
   and already outputs the same `{activity, confidence, signals}` shape
   your notification/status pipeline expects.

## Step 4 — Validate against reality (budget real time here)

Run the app live, perform each activity, and watch what gets predicted.
Things to watch for:
- **Confusions between visually similar activities** (Sitting vs Sleeping,
  Eating vs Drinking) — if these persist, it usually means those two
  activities weren't well separated in your training recordings (e.g. you
  recorded "Sitting" sessions that included some eating gestures). Re-record
  more cleanly separated sessions for the confused pair.
- **The threshold classifier is still there as a fallback** — if the LSTM
  isn't loaded (e.g. `norm_stats.json` missing), `USE_LSTM` silently falls
  back to thresholds via the try/catch in `initializePoseDetection`. Check
  your browser console for "LSTM model not found" — if it's ever hiding a
  real path/file mistake, you'll think you're testing the trained model when
  you're actually still on thresholds.

## Why this is the right scope for your timeline

- No new backend, no new inference service, no Python training pipeline —
  everything stays TF.js, in-browser, and slots into code you already have
  wired up.
- The 15-feature vector and 8 activity classes already match your existing
  `extractPoseFeatures()` output and downstream status/notification logic —
  nothing downstream needs to change.
- This is genuinely a step up from hand-tuned thresholds (a model that
  learns the actual boundary between "sitting with hand near face" and
  "eating" from real examples, instead of a fixed `handToMouth < 0.35`
  cutoff you have to guess), achievable in days because you're not building
  new infrastructure — you're filling in a contract your own code already
  defines.
