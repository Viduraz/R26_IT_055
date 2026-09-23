// schedule-monitoring/frontend/src/pages/DataCollector.jsx
/**
 * Training Data Collector
 *
 * Standalone page for recording labeled pose-feature sequences to train the
 * LSTM-HAR model referenced in activityDetection.js (LSTM_MODEL_PATH /
 * LSTM_STATS_PATH). Deliberately self-contained (own pose/object detectors,
 * own feature extraction) rather than importing from activityDetection.js,
 * because that module keeps pose history as private module-level state not
 * meant to be shared across two simultaneous consumers.
 *
 * IMPORTANT: extractPoseFeatures() below is a byte-for-byte copy of the
 * feature extraction in activityDetection.js. If you ever change one, change
 * both — the trained model's input contract depends on identical feature
 * order and math at both training time and inference time.
 *
 * Usage:
 *   1. Add a route to this component (e.g. /data-collector), dev-only.
 *   2. Pick an activity label, click "Start Recording", perform the activity
 *      in front of the webcam for 2-3 minutes.
 *   3. Switch labels between activities. Aim for a few thousand frames per
 *      activity (a few minutes each) covering natural variation: different
 *      distances from camera, partial occlusion, etc.
 *   4. Click "Export Session" to download a JSON file. Repeat across
 *      multiple people/sessions/lighting conditions if possible.
 *   5. Hand the exported JSON file(s) to train_har_model.js.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// Must match LSTM_ACTIVITY_NAMES in activityDetection.js exactly (order matters
// for training but not for collection — labels are stored as strings).
const ACTIVITY_LABELS = [
  'Walking',
  'Sitting / rest',
  'Sleeping',
  'Eating',
  'Drinking'
];

export default function DataCollector() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const objectDetectorRef = useRef(null);
  const poseHistoryRef = useRef([]);
  const lastObjectsRef = useRef([]);
  const frameCountRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [currentLabel, setCurrentLabel] = useState(ACTIVITY_LABELS[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [counts, setCounts] = useState(() =>
    Object.fromEntries(ACTIVITY_LABELS.map(l => [l, 0]))
  );

  // Recorded samples live in a ref (not state) so the per-frame loop never
  // re-renders the whole component — counts (state) are updated separately,
  // throttled, purely for the on-screen readout.
  const samplesRef = useRef([]);

  const isRecordingRef = useRef(false);
  const currentLabelRef = useRef(currentLabel);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { currentLabelRef.current = currentLabel; }, [currentLabel]);

  // ── Feature extraction (copied from activityDetection.js) ─────────────────
  const calculateAngle = (pointA, pointB, pointC) => {
    if (!pointA || !pointB || !pointC) return 0;
    const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
      Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
  };

  const euclideanDistance = (pointA, pointB) => {
    if (!pointA || !pointB) return Infinity;
    return Math.sqrt(Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2));
  };

  const calculateMovementVelocity = (currentKeypoints, poseHistory) => {
    if (poseHistory.length < 2) return 0;
    const prevKeypoints = poseHistory[poseHistory.length - 1];
    let totalMovement = 0;
    let count = 0;
    const keypointsToTrack = [0, 9, 10, 15, 16];
    for (const idx of keypointsToTrack) {
      if (currentKeypoints[idx] && prevKeypoints[idx] &&
        currentKeypoints[idx].score > 0.3 && prevKeypoints[idx].score > 0.3) {
        const dx = currentKeypoints[idx].x - prevKeypoints[idx].x;
        const dy = currentKeypoints[idx].y - prevKeypoints[idx].y;
        totalMovement += Math.sqrt(dx * dx + dy * dy);
        count++;
      }
    }
    return count > 0 ? totalMovement / count : 0;
  };

  const calculateWristOscillation = (currentKeypoints, poseHistory) => {
    if (poseHistory.length < 3) return 0;
    let wristMovement = 0;
    let wristCount = 0;
    const wristIndices = [9, 10];
    for (let i = Math.max(0, poseHistory.length - 5); i < poseHistory.length; i++) {
      const prev = poseHistory[i];
      for (const idx of wristIndices) {
        if (currentKeypoints[idx] && prev[idx] &&
          currentKeypoints[idx].score > 0.3 && prev[idx].score > 0.3) {
          const dx = currentKeypoints[idx].x - prev[idx].x;
          const dy = currentKeypoints[idx].y - prev[idx].y;
          wristMovement += Math.sqrt(dx * dx + dy * dy);
          wristCount++;
        }
      }
    }
    return wristCount > 0 ? wristMovement / wristCount : 0;
  };

  const extractPoseFeatures = (keypoints, poseHistory) => {
    if (!keypoints || keypoints.length < 17) return null;

    const indices = {
      nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
      leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8,
      leftWrist: 9, rightWrist: 10, leftHip: 11, rightHip: 12,
      leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16
    };

    const kp = {};
    keypoints.forEach((point, idx) => {
      kp[Object.keys(indices).find(key => indices[key] === idx)] = point;
    });

    const features = [];

    const shoulderMidX = (kp.leftShoulder.x + kp.rightShoulder.x) / 2;
    const shoulderMidY = (kp.leftShoulder.y + kp.rightShoulder.y) / 2;
    const hipMidX = (kp.leftHip.x + kp.rightHip.x) / 2;
    const hipMidY = (kp.leftHip.y + kp.rightHip.y) / 2;

    const torsoDX = Math.abs(hipMidX - shoulderMidX);
    const torsoDY = Math.abs(hipMidY - shoulderMidY);
    const torsoHeight = torsoDY;
    const torsoAlignment = torsoDX / (torsoDY + 0.001);

    features.push(torsoHeight);

    const leftLegAngle = calculateAngle(kp.leftHip, kp.leftKnee, kp.leftAnkle);
    const rightLegAngle = calculateAngle(kp.rightHip, kp.rightKnee, kp.rightAnkle);
    features.push(leftLegAngle, rightLegAngle);

    const leftArmAngle = calculateAngle(kp.leftShoulder, kp.leftElbow, kp.leftWrist);
    const rightArmAngle = calculateAngle(kp.rightShoulder, kp.rightElbow, kp.rightWrist);
    features.push(leftArmAngle, rightArmAngle);

    const noseY = kp.nose.y;
    const ankleY = Math.max(kp.leftAnkle.y, kp.rightAnkle.y);
    const bodyHeight = Math.abs(ankleY - noseY);
    features.push(bodyHeight);

    const shoulderWidth = Math.abs(kp.leftShoulder.x - kp.rightShoulder.x);
    features.push(shoulderWidth);

    const noseX = kp.nose.x;
    const leftWristDist = euclideanDistance(kp.leftWrist, { x: noseX, y: noseY });
    const rightWristDist = euclideanDistance(kp.rightWrist, { x: noseX, y: noseY });
    const minHandToMouth = Math.min(leftWristDist, rightWristDist);
    features.push(minHandToMouth);

    const velocity = calculateMovementVelocity(keypoints, poseHistory);
    features.push(velocity);

    const legAsymmetry = Math.abs(leftLegAngle - rightLegAngle);
    features.push(legAsymmetry);

    const hipHeight = (kp.leftHip.y + kp.rightHip.y) / 2;
    features.push(hipHeight);

    const leftWristY = (kp.leftWrist && kp.leftWrist.score > 0.3) ? kp.leftWrist.y : 1.0;
    const rightWristY = (kp.rightWrist && kp.rightWrist.score > 0.3) ? kp.rightWrist.y : 1.0;
    const maxWristHeight = Math.min(leftWristY, rightWristY);
    features.push(maxWristHeight);

    const shoulderAvgY = (kp.leftShoulder.y + kp.rightShoulder.y) / 2;
    const minElbowY = Math.min(kp.leftElbow.y, kp.rightElbow.y);
    const elbowAboveShoulder = shoulderAvgY - minElbowY;
    features.push(elbowAboveShoulder);

    const wristOscillation = calculateWristOscillation(keypoints, poseHistory);
    features.push(wristOscillation);

    features.push(torsoAlignment);

    return features;
  };

  // ── Setup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });
        if (cancelled) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        await tf.setBackend('webgl');
        await tf.ready();

        detectorRef.current = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
            enableSmoothing: true,
            minPoseScore: 0.25,
          }
        );

        objectDetectorRef.current = await cocoSsd.load();

        if (!cancelled) {
          setReady(true);
          loop();
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e.message || String(e));
      }
    }

    async function loop() {
      if (cancelled) return;
      try {
        const video = videoRef.current;
        const poses = await detectorRef.current.estimatePoses(video);

        // Object detection every ~3rd frame — expensive, and food/cup/bed
        // context doesn't change frame to frame.
        frameCountRef.current++;
        if (frameCountRef.current % 3 === 0) {
          lastObjectsRef.current = await objectDetectorRef.current.detect(video);
        }

        if (poses && poses.length > 0) {
          const width = video.videoWidth || 640;
          const height = video.videoHeight || 480;
          const normalizedKeypoints = poses[0].keypoints.map(p => ({
            ...p, x: p.x / width, y: p.y / height
          }));

          const features = extractPoseFeatures(normalizedKeypoints, poseHistoryRef.current);

          poseHistoryRef.current.push(normalizedKeypoints);
          if (poseHistoryRef.current.length > 12) poseHistoryRef.current.shift();

          if (features && isRecordingRef.current) {
            samplesRef.current.push({
              t: Date.now(),
              label: currentLabelRef.current,
              features,
              objects: lastObjectsRef.current.map(o => o.class),
            });

            // Throttled UI update — every 10 samples, not every frame.
            if (samplesRef.current.length % 10 === 0) {
              const c = Object.fromEntries(ACTIVITY_LABELS.map(l => [l, 0]));
              for (const s of samplesRef.current) c[s.label] = (c[s.label] || 0) + 1;
              setCounts(c);
            }
          }

          drawOverlay(normalizedKeypoints, width, height);
        }
      } catch (e) {
        console.error('loop error', e);
      }
      if (!cancelled) requestAnimationFrame(loop);
    }

    function drawOverlay(keypoints, width, height) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== videoRef.current.videoWidth) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#39d353';
      keypoints.forEach(kp => {
        if (kp.score > 0.3) {
          ctx.beginPath();
          ctx.arc(kp.x * canvas.width, kp.y * canvas.height, 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      });
    }

    setup();
    return () => {
      cancelled = true;
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      if (detectorRef.current) detectorRef.current.dispose();
    };
  }, []);

  const exportSession = useCallback(() => {
    const data = samplesRef.current;
    if (data.length === 0) {
      alert('No samples recorded yet.');
      return;
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `har_session_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearSession = useCallback(() => {
    if (!window.confirm('Clear all recorded samples for this session?')) return;
    samplesRef.current = [];
    setCounts(Object.fromEntries(ACTIVITY_LABELS.map(l => [l, 0])));
  }, []);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div style={styles.page}>
      <h2 style={styles.h2}>Training Data Collector</h2>
      <p style={styles.hint}>
        Pick a label, hit Start, perform that activity. Switch labels between
        activities. Aim for 2–3 minutes (a few thousand frames) per activity,
        across a few sessions with natural variation.
      </p>

      {error && <div style={styles.error}>Camera/model error: {error}</div>}

      <div style={styles.videoWrap}>
        <video ref={videoRef} style={styles.video} muted playsInline />
        <canvas ref={canvasRef} style={styles.canvas} />
      </div>

      <div style={styles.labelGrid}>
        {ACTIVITY_LABELS.map(label => (
          <button
            key={label}
            onClick={() => setCurrentLabel(label)}
            style={{
              ...styles.labelBtn,
              ...(currentLabel === label ? styles.labelBtnActive : {}),
            }}
          >
            {label}
            <span style={styles.count}>{counts[label] || 0}</span>
          </button>
        ))}
      </div>

      <div style={styles.controls}>
        <button
          onClick={() => setIsRecording(r => !r)}
          disabled={!ready}
          style={{ ...styles.recordBtn, ...(isRecording ? styles.recordBtnActive : {}) }}
        >
          {isRecording ? '● Recording — Stop' : 'Start Recording'}
        </button>
        <button onClick={exportSession} style={styles.secondaryBtn}>
          Export Session ({total} frames)
        </button>
        <button onClick={clearSession} style={styles.dangerBtn}>
          Clear
        </button>
      </div>

      <div style={styles.status}>
        {ready ? 'Models loaded.' : 'Loading MoveNet + COCO-SSD…'}
        {' — Current label: '}<strong>{currentLabel}</strong>
      </div>
    </div>
  );
}

const styles = {
  page: { maxWidth: 720, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' },
  h2: { marginBottom: 4 },
  hint: { color: '#666', fontSize: 14, marginBottom: 16 },
  error: { background: '#fee', color: '#900', padding: 10, borderRadius: 6, marginBottom: 12 },
  videoWrap: { position: 'relative', width: 640, height: 480, background: '#111', borderRadius: 8, overflow: 'hidden' },
  video: { width: 640, height: 480, transform: 'scaleX(-1)' },
  canvas: { position: 'absolute', top: 0, left: 0, width: 640, height: 480, transform: 'scaleX(-1)' },
  labelGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 },
  labelBtn: {
    padding: '10px 6px', borderRadius: 6, border: '1px solid #ccc',
    background: '#fafafa', cursor: 'pointer', fontSize: 13, display: 'flex',
    flexDirection: 'column', alignItems: 'center', gap: 4,
  },
  labelBtnActive: { background: '#1a73e8', color: '#fff', borderColor: '#1a73e8' },
  count: { fontSize: 12, opacity: 0.75 },
  controls: { display: 'flex', gap: 10, marginTop: 18 },
  recordBtn: { padding: '10px 18px', borderRadius: 6, border: 'none', background: '#333', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  recordBtnActive: { background: '#d93025' },
  secondaryBtn: { padding: '10px 18px', borderRadius: 6, border: '1px solid #333', background: '#fff', cursor: 'pointer' },
  dangerBtn: { padding: '10px 18px', borderRadius: 6, border: '1px solid #d93025', color: '#d93025', background: '#fff', cursor: 'pointer' },
  status: { marginTop: 14, fontSize: 13, color: '#555' },
};
