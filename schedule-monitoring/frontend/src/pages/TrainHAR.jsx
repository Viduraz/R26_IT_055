import React, { useState } from 'react';
import * as tf from '@tensorflow/tfjs';

const SEQ_LEN = 30;
const ACTIVITY_NAMES = [
  'Sleeping', 'Eating', 'Drinking', 'Taking Medications',
  'Walking', 'Sitting / rest', 'Standing', 'Movement'
];
const NUM_FEATURES = 15;
const WINDOW_STRIDE = 5;

export default function TrainHAR() {
  const [status, setStatus] = useState('Ready. Upload your har_session_*.json files.');
  const [logs, setLogs] = useState([]);
  const [isTraining, setIsTraining] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  const addLog = (msg) => {
    setLogs(prev => [...prev, msg]);
    console.log(msg);
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsTraining(true);
    setLogs([]);
    setModelReady(false);
    setStatus('Loading files...');

    try {
      await tf.setBackend('webgl');
      await tf.ready();
      addLog('Backend: ' + tf.getBackend());

      // 1. Load sessions
      const sessions = [];
      for (const file of files) {
        const text = await file.text();
        const data = JSON.parse(text);
        sessions.push(data.sort((a, b) => a.t - b.t));
        addLog(`Loaded: ${file.name} (${data.length} frames)`);
      }

      // 2. Build windows
      const windows = [];
      const labelCounts = Object.fromEntries(ACTIVITY_NAMES.map(l => [l, 0]));

      for (const session of sessions) {
        let runStart = 0;
        for (let i = 1; i <= session.length; i++) {
          const boundary = i === session.length || session[i].label !== session[runStart].label;
          if (boundary) {
            const run = session.slice(runStart, i);
            const label = run[0].label;
            if (ACTIVITY_NAMES.includes(label)) {
              for (let start = 0; start + SEQ_LEN <= run.length; start += WINDOW_STRIDE) {
                windows.push({
                  features: run.slice(start, start + SEQ_LEN).map(f => f.features),
                  label,
                });
                labelCounts[label]++;
              }
            }
            runStart = i;
          }
        }
      }

      addLog('\nWindow counts:');
      Object.entries(labelCounts).forEach(([k, v]) => {
        if (v > 0) addLog(`  ${k}: ${v}`);
      });

      if (windows.length < 20) {
        throw new Error('Not enough data. Record longer sessions.');
      }

      // 3. Balance classes
      const byLabel = {};
      windows.forEach(w => {
        (byLabel[w.label] = byLabel[w.label] || []).push(w);
      });
      const minCount = Math.min(...Object.values(byLabel).map(a => a.length).filter(c => c > 0));
      const balanced = [];
      Object.values(byLabel).forEach(arr => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        balanced.push(...arr.slice(0, minCount));
      });
      addLog(`\nBalanced to ${minCount} windows per class`);

      // Shuffle
      for (let i = balanced.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [balanced[i], balanced[j]] = [balanced[j], balanced[i]];
      }

      const splitIdx = Math.floor(balanced.length * 0.85);
      const trainWindows = balanced.slice(0, splitIdx);
      const valWindows = balanced.slice(splitIdx);
      addLog(`Train: ${trainWindows.length} | Val: ${valWindows.length}`);

      // 4. Normalize
      const sums = new Array(NUM_FEATURES).fill(0);
      const sqSums = new Array(NUM_FEATURES).fill(0);
      let frameCount = 0;
      trainWindows.forEach(w => {
        w.features.forEach(frame => {
          frame.forEach((v, i) => {
            sums[i] += v;
            sqSums[i] += v * v;
          });
          frameCount++;
        });
      });
      const mean = sums.map(s => s / frameCount);
      const std = sqSums.map((sq, i) => Math.sqrt(Math.max(sq / frameCount - mean[i] * mean[i], 1e-6)));

      const normalize = (features) =>
        features.map(frame => frame.map((v, i) => (v - mean[i]) / std[i]));

      // 5. Create tensors
      const trainXs = tf.tensor3d(trainWindows.map(w => normalize(w.features)));
      const trainYs = tf.tensor2d(trainWindows.map(w => {
        const oneHot = new Array(ACTIVITY_NAMES.length).fill(0);
        oneHot[ACTIVITY_NAMES.indexOf(w.label)] = 1;
        return oneHot;
      }));
      const valXs = tf.tensor3d(valWindows.map(w => normalize(w.features)));
      const valYs = tf.tensor2d(valWindows.map(w => {
        const oneHot = new Array(ACTIVITY_NAMES.length).fill(0);
        oneHot[ACTIVITY_NAMES.indexOf(w.label)] = 1;
        return oneHot;
      }));

      // 6. Build model (same architecture as activityDetection.js expects)
      const model = tf.sequential();
      model.add(tf.layers.lstm({
        units: 32,
        inputShape: [SEQ_LEN, NUM_FEATURES],
        returnSequences: false,
      }));
      model.add(tf.layers.dropout({ rate: 0.3 }));
      model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
      model.add(tf.layers.dense({
        units: ACTIVITY_NAMES.length,
        activation: 'softmax',
      }));

      model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy'],
      });

      setStatus('Training... Please wait (1–3 minutes)');
      addLog('\nStarting training...\n');

      await model.fit(trainXs, trainYs, {
        epochs: 35,
        batchSize: 16,
        validationData: [valXs, valYs],
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            addLog(
              `Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)} acc=${logs.acc.toFixed(4)} ` +
              `val_acc=${logs.val_acc.toFixed(4)}`
            );
          },
        },
      });

      // 7. Save model to IndexedDB (most reliable)
      await model.save('indexeddb://lstm-har-model');
      addLog('\n✓ Model saved to browser storage');

      // Save norm stats
      localStorage.setItem('lstm_norm_stats', JSON.stringify({ mean, std }));
      addLog('✓ Normalization stats saved');

      setModelReady(true);
      setStatus('Training finished! Click the blue button below to download the model.');

      trainXs.dispose();
      trainYs.dispose();
      valXs.dispose();
      valYs.dispose();
      model.dispose();

    } catch (err) {
      console.error(err);
      setStatus('Error: ' + err.message);
      addLog('Error: ' + err.message);
    } finally {
      setIsTraining(false);
    }
  };

  const downloadModel = async () => {
    try {
      addLog('\nPreparing download...');
      const model = await tf.loadLayersModel('indexeddb://lstm-har-model');

      // Standard TensorFlow.js download (most reliable)
      await model.save('downloads://lstm_har_model');
      addLog('✓ Model download started (check Downloads folder)');

      // Download norm_stats.json
      const stats = localStorage.getItem('lstm_norm_stats');
      if (stats) {
        const blob = new Blob([stats], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'norm_stats.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('✓ norm_stats.json downloaded');
      }

      setStatus('Download started. Check your Downloads folder.');
    } catch (err) {
      addLog('Download error: ' + err.message);
      setStatus('Download failed: ' + err.message);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1>Train HAR Model (Browser)</h1>
      <p style={{ color: '#555' }}>
        Select all your <code>har_session_*.json</code> files and start training.
      </p>

      <div style={{ margin: '20px 0' }}>
        <input
          type="file"
          multiple
          accept=".json"
          onChange={handleFiles}
          disabled={isTraining}
        />
      </div>

      {modelReady && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={downloadModel}
            style={{
              padding: '12px 24px',
              background: '#1a73e8',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 16,
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Download Model Files
          </button>
        </div>
      )}

      <div style={{
        padding: 12,
        background: '#f0f4f8',
        borderRadius: 8,
        marginBottom: 16,
        fontWeight: 600
      }}>
        {status}
      </div>

      <div style={{
        background: '#111',
        color: '#0f0',
        padding: 16,
        borderRadius: 8,
        height: 400,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 13,
        whiteSpace: 'pre-wrap'
      }}>
        {logs.join('\n') || 'Logs will appear here...'}
      </div>
    </div>
  );
}