/**
 * train_har_model.js
 *
 * Trains the LSTM-HAR model that activityDetection.js is already wired to
 * load (see LSTM_MODEL_PATH, LSTM_STATS_PATH, LSTM_SEQ_LEN, LSTM_ACTIVITY_NAMES
 * in that file). Output matches that contract exactly — flip USE_LSTM = true
 * in activityDetection.js when done, no other code changes needed.
 *
 * ── Setup ───────────────────────────────────────────────────────────────────
 *   mkdir har-training && cd har-training
 *   npm init -y
 *   npm install @tensorflow/tfjs-node
 *   mkdir data
 *   # copy every har_session_*.json exported from DataCollector.jsx into ./data
 *
 * ── Run ─────────────────────────────────────────────────────────────────────
 *   node train_har_model.js
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 *   ./output/model.json + weight files   → copy to public/lstm_har_model/model.json
 *   ./output/norm_stats.json             → copy to public/lstm_har_model/norm_stats.json
 *
 * (paths must match LSTM_MODEL_PATH = '/lstm_har_model/model.json' and
 *  LSTM_STATS_PATH = '/lstm_har_model/norm_stats.json' in activityDetection.js)
 */

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');

// ── Must match activityDetection.js exactly ─────────────────────────────────
const SEQ_LEN = 30;
const ACTIVITY_NAMES = [
  'Walking',
  'Sitting / rest',
  'Sleeping',
  'Eating',
  'Drinking'
];
const NUM_FEATURES = 15;

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_DIR = path.join(__dirname, 'output');
const WINDOW_STRIDE = 5; // overlap windows — more training examples per session

// ── 1. Load all session files ───────────────────────────────────────────────
function loadSessions() {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Missing ./data directory. Put har_session_*.json files there.`);
  }
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`No .json files found in ./data — export sessions from DataCollector.jsx first.`);
  }
  console.log(`Found ${files.length} session file(s):`, files);

  const sessions = files.map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    return raw.sort((a, b) => a.t - b.t); // ensure chronological order
  });
  return sessions;
}

// ── 2. Build fixed-length windows, never crossing a label boundary ─────────
function buildWindows(sessions) {
  const windows = [];
  const labelCounts = Object.fromEntries(ACTIVITY_NAMES.map(l => [l, 0]));

  for (const session of sessions) {
    // Split into contiguous runs of the same label (label changes when you
    // click a different button in the collector — a run boundary).
    let runStart = 0;
    for (let i = 1; i <= session.length; i++) {
      const boundary = i === session.length || session[i].label !== session[runStart].label;
      if (boundary) {
        const run = session.slice(runStart, i);
        const label = run[0].label;

        if (ACTIVITY_NAMES.includes(label)) {
          for (let start = 0; start + SEQ_LEN <= run.length; start += WINDOW_STRIDE) {
            const windowFrames = run.slice(start, start + SEQ_LEN);
            windows.push({
              features: windowFrames.map(f => f.features),
              label,
            });
            labelCounts[label]++;
          }
        }
        runStart = i;
      }
    }
  }

  console.log('\nWindow counts per activity (before balancing):');
  console.table(labelCounts);

  return windows;
}

// ── 3. Balance classes (undersample majority classes) ───────────────────────
function balanceWindows(windows) {
  const byLabel = {};
  for (const w of windows) {
    (byLabel[w.label] = byLabel[w.label] || []).push(w);
  }
  const counts = Object.values(byLabel).map(a => a.length).filter(c => c > 0);
  if (counts.length === 0) return windows;
  const minCount = Math.min(...counts);

  const balanced = [];
  for (const label of Object.keys(byLabel)) {
    const arr = byLabel[label];
    // shuffle then take minCount
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    balanced.push(...arr.slice(0, minCount));
  }

  console.log(`\nBalanced to ${minCount} windows per class (classes with 0 samples are skipped — you need at least one recording session for every activity).`);
  return balanced;
}

// ── 4. Normalize ─────────────────────────────────────────────────────────────
function computeNormStats(windows) {
  const sums = new Array(NUM_FEATURES).fill(0);
  const sqSums = new Array(NUM_FEATURES).fill(0);

  for (const w of windows) {
    for (const frame of w.features) {
      for (let i = 0; i < NUM_FEATURES; i++) {
        sums[i] += frame[i];
        sqSums[i] += frame[i] * frame[i];
      }
    }
  }
  const frameCount = windows.reduce((acc, w) => acc + w.features.length, 0);
  const mean = sums.map(s => s / frameCount);
  const std = sqSums.map((sq, i) => {
    const variance = sq / frameCount - mean[i] * mean[i];
    return Math.sqrt(Math.max(variance, 1e-6));
  });

  return { mean, std };
}

function normalizeWindow(features, mean, std) {
  return features.map(frame => frame.map((v, i) => (v - mean[i]) / std[i]));
}

// ── 5. Build tensors ─────────────────────────────────────────────────────────
function toTensors(windows, mean, std) {
  const xs = windows.map(w => normalizeWindow(w.features, mean, std));
  const ys = windows.map(w => {
    const idx = ACTIVITY_NAMES.indexOf(w.label);
    const oneHot = new Array(ACTIVITY_NAMES.length).fill(0);
    oneHot[idx] = 1;
    return oneHot;
  });

  return {
    xs: tf.tensor3d(xs, [xs.length, SEQ_LEN, NUM_FEATURES]),
    ys: tf.tensor2d(ys, [ys.length, ACTIVITY_NAMES.length]),
  };
}

// ── 6. Model ─────────────────────────────────────────────────────────────────
function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: 32,
    inputShape: [SEQ_LEN, NUM_FEATURES],
    returnSequences: false,
  }));
  model.add(tf.layers.dropout({ rate: 0.3 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: ACTIVITY_NAMES.length, activation: 'softmax' }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const sessions = loadSessions();
  let windows = buildWindows(sessions);

  if (windows.length < 50) {
    console.warn(
      `\n⚠ Only ${windows.length} training windows found. This is thin — expect ` +
      `unreliable accuracy. Record longer sessions (aim for a few thousand raw ` +
      `frames = a few minutes per activity) before trusting this model.\n`
    );
  }

  windows = balanceWindows(windows);

  // Shuffle before split
  for (let i = windows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [windows[i], windows[j]] = [windows[j], windows[i]];
  }

  const splitIdx = Math.floor(windows.length * 0.85);
  const trainWindows = windows.slice(0, splitIdx);
  const valWindows = windows.slice(splitIdx);

  console.log(`\nTrain windows: ${trainWindows.length} | Val windows: ${valWindows.length}`);

  const { mean, std } = computeNormStats(trainWindows);

  const { xs: trainXs, ys: trainYs } = toTensors(trainWindows, mean, std);
  const { xs: valXs, ys: valYs } = toTensors(valWindows, mean, std);

  const model = buildModel();
  model.summary();

  console.log('\nTraining…\n');
  await model.fit(trainXs, trainYs, {
    epochs: 40,
    batchSize: 16,
    validationData: [valXs, valYs],
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log(
          `epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)} acc=${logs.acc.toFixed(4)} ` +
          `val_loss=${logs.val_loss.toFixed(4)} val_acc=${logs.val_acc.toFixed(4)}`
        );
      },
    },
  });

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  await model.save(`file://${OUTPUT_DIR}`);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'norm_stats.json'),
    JSON.stringify({ mean, std }, null, 2)
  );

  console.log(`\n✓ Saved model + norm_stats.json to ${OUTPUT_DIR}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Copy ${OUTPUT_DIR}/model.json, ${OUTPUT_DIR}/*.bin, and`);
  console.log(`     ${OUTPUT_DIR}/norm_stats.json into your React app's`);
  console.log(`     public/lstm_har_model/ directory.`);
  console.log(`  2. In activityDetection.js, set: const USE_LSTM = true;`);
  console.log(`  3. Test live — watch val_acc above; if it's well below train`);
  console.log(`     accuracy, you likely need more/more-varied recorded data.`);

  trainXs.dispose(); trainYs.dispose(); valXs.dispose(); valYs.dispose();
}

main().catch(err => {
  console.error('\nTraining failed:', err.message);
  process.exit(1);
});
