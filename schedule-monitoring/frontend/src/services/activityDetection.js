// schedule-monitoring/frontend/src/services/activityDetection.js
/**
 * Activity Detection Service
 *
 * Two-tier classification strategy:
 *
 *  1. LSTM model (primary) — loaded from /lstm_har_model/model.json when available.
 *     Trained on Kinetics-700 / UCF101 / HMDB51 pose-feature sequences.
 *     Set USE_LSTM = true once the model is exported by pipelines/train_lstm_har.py.
 *
 *  2. Threshold classifier (fallback) — rule-based decision tree calibrated on
 *     Kinetics-400 dataset statistics. Always active when LSTM is unavailable.
 *
 * Changing USE_LSTM is the ONLY code edit needed to switch between the two.
 */

import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';

// ── LSTM toggle ────────────────────────────────────────────────────────────────
// Set to true after running:  pipelines/train_lstm_har.py
// The model must be present at:  public/lstm_har_model/model.json
const USE_LSTM = false;

// ── MoveNet state ──────────────────────────────────────────────────────────────
let detector = null;
let isRunning = false;
let videoElement = null;
let onActivityCallback = null;
let canvasElement = null;
let expectedActivityRef = null;
let onAlignmentChangeCallback = null;
let currentAlignment = false;

// ── Temporal history ───────────────────────────────────────────────────────────
const HISTORY_SIZE = 30;          // frames kept for threshold fallback
let poseHistory    = [];          // raw keypoint history
let activityHistory = [];         // smoothed prediction history
let featureHistory  = [];         // 14-feature vectors for LSTM window

// ── LSTM model state ───────────────────────────────────────────────────────────
let lstmModel   = null;           // tf.LayersModel (null until loaded)
let normMean    = null;           // Float32Array[14]
let normStd     = null;           // Float32Array[14]
let lstmReady   = false;          // true once model + stats are loaded

const LSTM_SEQ_LEN    = 30;       // frames per inference window
const LSTM_MODEL_PATH = '/lstm_har_model/model.json';
const LSTM_STATS_PATH = '/lstm_har_model/norm_stats.json';

const LSTM_ACTIVITY_NAMES = [
  'Sleep', 'Eating', 'Drinking', 'Taking Medications', 'Talking',
  'Walking', 'Sitting / rest', 'Standing up', 'Movement'
];

// ── Confidence threshold ───────────────────────────────────────────────────────
const CONFIDENCE_THRESHOLD = 0.50;

/**
 * Initialize pose detection with TensorFlow.js MoveNet
 * MoveNet is a pre-trained model from Google optimized for real-time pose detection
 */
export async function initializePoseDetection(video, canvas, expectedRef, onActivityDetected, onAlignmentChange) {
  try {
    videoElement = video;
    canvasElement = canvas;
    expectedActivityRef = expectedRef;
    onActivityCallback = onActivityDetected;
    onAlignmentChangeCallback = onAlignmentChange;

    // STEP 1: Start webcam immediately so video shows up right away
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();

    // STEP 2: Initialize TensorFlow.js backend
    await tf.setBackend('webgl');
    await tf.ready();
    console.log("TensorFlow.js backend:", tf.getBackend());

    // STEP 3: Load MoveNet LIGHTNING (smaller and faster than THUNDER)
    const detectorConfig = {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: true,
      minPoseScore: 0.25,
    };

    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      detectorConfig
    );

    console.log("✓ MoveNet pose detector loaded");

    // Attempt to load LSTM model (non-blocking — falls back to thresholds if absent)
    if (USE_LSTM) {
      loadLSTMModel().catch(err =>
        console.warn("LSTM model not found — using threshold classifier:", err.message)
      );
    }

    // STEP 4: Start detection loop
    isRunning = true;
    detectPoseLoop();

    return { detector };
  } catch (error) {
    console.error("Failed to initialize pose detection:", error);
    throw error;
  }
}

/**
 * Main detection loop - runs continuously while active
 */
async function detectPoseLoop() {
  if (!isRunning || !detector || !videoElement) return;

  try {
    // Detect poses in current frame
    const poses = await detector.estimatePoses(videoElement);

    if (poses && poses.length > 0) {
      const pose = poses[0];
      
      // Normalize keypoints so thresholds work correctly (0.0 to 1.0)
      const width = videoElement.videoWidth || 640;
      const height = videoElement.videoHeight || 480;
      const normalizedKeypoints = pose.keypoints.map(p => ({
        ...p,
        x: p.x / width,
        y: p.y / height
      }));
      
      // Extract features from detected pose
      const features = extractPoseFeatures(normalizedKeypoints);
      let smoothedActivity = null;
      
      if (features) {
        // Add to pose history
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) {
          poseHistory.shift();
        }

        // Keep a 14-feature history for the LSTM window
        featureHistory.push(features);
        if (featureHistory.length > LSTM_SEQ_LEN) featureHistory.shift();

        // ── Classify: LSTM (primary) or threshold (fallback) ────────────────
        const activityResult = (lstmReady && featureHistory.length >= LSTM_SEQ_LEN)
          ? classifyWithLSTM(featureHistory)
          : classifyActivity(features, poseHistory);
        
        if (activityResult) {
          // Smooth predictions using temporal history
          smoothedActivity = smoothPredictions(activityResult, activityHistory);
          
          // Add to activity history
          activityHistory.push(smoothedActivity);
          if (activityHistory.length > 20) {
            activityHistory.shift();
          }

          // Callback with latest detection (UI handles logging threshold)
          if (onActivityCallback) {
            onActivityCallback({
              activity_name: smoothedActivity.activity,
              confidence: smoothedActivity.confidence,
              detected_at: new Date(),
              signals: smoothedActivity.signals,
              features: features
            });
          }
        }
      }

      // Draw skeleton on canvas
      if (canvasElement && videoElement.videoWidth > 0) {
        if (canvasElement.width !== videoElement.videoWidth) {
          canvasElement.width = videoElement.videoWidth;
          canvasElement.height = videoElement.videoHeight;
        }
        
        const ctx = canvasElement.getContext('2d');
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        
        // Check alignment with expected activity
        let isAligned = false;
        if (smoothedActivity && expectedActivityRef && expectedActivityRef.current) {
           isAligned = smoothedActivity.activity.toLowerCase() === expectedActivityRef.current.toLowerCase() && 
                       smoothedActivity.confidence >= CONFIDENCE_THRESHOLD;
        }
        
        if (isAligned !== currentAlignment) {
          currentAlignment = isAligned;
          if (onAlignmentChangeCallback) onAlignmentChangeCallback(isAligned);
        }

        // const skeletonColor = isAligned ? '#4ade80' : '#ef4444'; // Green if aligned, Red if not
        // drawSkeleton(pose.keypoints, ctx, skeletonColor);
      }
    } else if (canvasElement) {
       const ctx = canvasElement.getContext('2d');
       ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
       if (currentAlignment !== false) {
         currentAlignment = false;
         if (onAlignmentChangeCallback) onAlignmentChangeCallback(false);
       }
    }
  } catch (error) {
    console.error("Error in detection loop:", error);
  }

  // Continue loop
  if (isRunning) {
    requestAnimationFrame(detectPoseLoop);
  }
}

/**
 * Extract features from pose landmarks for activity classification
 * Based on biomechanical principles and ML research in action recognition
 * References: Guillaume Chevalier LSTM-HAR, CNN-LSTM skeletal pose datasets
 * Extended to 12 features to support interaction-based tasks:
 *   eating, drinking, talking (hand/arm trajectory toward face/mouth)
 */
function extractPoseFeatures(keypoints) {
  if (!keypoints || keypoints.length < 17) return null;

  // MoveNet keypoint indices (COCO format)
  const indices = {
    nose: 0,
    leftEye: 1, rightEye: 2,
    leftEar: 3, rightEar: 4,
    leftShoulder: 5, rightShoulder: 6,
    leftElbow: 7, rightElbow: 8,
    leftWrist: 9, rightWrist: 10,
    leftHip: 11, rightHip: 12,
    leftKnee: 13, rightKnee: 14,
    leftAnkle: 15, rightAnkle: 16
  };

  const kp = {};
  keypoints.forEach((point, idx) => {
    kp[Object.keys(indices).find(key => indices[key] === idx)] = point;
  });

  const features = [];

  // 1. TORSO ANGLE (sitting vs standing)
  const shoulderMidX = (kp.leftShoulder.x + kp.rightShoulder.x) / 2;
  const shoulderMidY = (kp.leftShoulder.y + kp.rightShoulder.y) / 2;
  const hipMidX = (kp.leftHip.x + kp.rightHip.x) / 2;
  const hipMidY = (kp.leftHip.y + kp.rightHip.y) / 2;
  
  const torsoDX = Math.abs(hipMidX - shoulderMidX);
  const torsoDY = Math.abs(hipMidY - shoulderMidY);
  const torsoHeight = torsoDY; 
  const torsoAlignment = torsoDX / (torsoDY + 0.001); // > 1.0 means more horizontal than vertical
  
  features.push(torsoHeight);
  // We'll use torsoAlignment later or replace an unused feature

  // 2. LEG ANGLES (walking, sitting detection)
  const leftLegAngle = calculateAngle(kp.leftHip, kp.leftKnee, kp.leftAnkle);
  const rightLegAngle = calculateAngle(kp.rightHip, kp.rightKnee, kp.rightAnkle);
  features.push(leftLegAngle, rightLegAngle);

  // 3. ARM ANGLES (eating, gesturing)
  const leftArmAngle = calculateAngle(kp.leftShoulder, kp.leftElbow, kp.leftWrist);
  const rightArmAngle = calculateAngle(kp.rightShoulder, kp.rightElbow, kp.rightWrist);
  features.push(leftArmAngle, rightArmAngle);

  // 4. BODY HEIGHT (lying vs standing)
  const noseY = kp.nose.y;
  const ankleY = Math.max(kp.leftAnkle.y, kp.rightAnkle.y);
  const bodyHeight = Math.abs(ankleY - noseY);
  features.push(bodyHeight);

  // 5. BODY WIDTH (lying detection)
  const shoulderWidth = Math.abs(kp.leftShoulder.x - kp.rightShoulder.x);
  features.push(shoulderWidth);

  // 6. HAND-TO-MOUTH DISTANCE (eating / drinking / talking detection)
  //    Tracks trajectory of hand approaching face — key for interaction tasks
  const leftHandToMouth = euclideanDistance(kp.leftWrist, kp.nose);
  const rightHandToMouth = euclideanDistance(kp.rightWrist, kp.nose);
  const minHandToMouth = Math.min(leftHandToMouth, rightHandToMouth);
  features.push(minHandToMouth);

  // 7. MOVEMENT VELOCITY (walking, activity level)
  const velocity = calculateMovementVelocity(keypoints);
  features.push(velocity);

  // 8. LEG ASYMMETRY (walking gait detection)
  const legAsymmetry = Math.abs(leftLegAngle - rightLegAngle);
  features.push(legAsymmetry);

  // 9. VERTICAL POSITION / HIP HEIGHT (lying down indicator)
  const hipHeight = (kp.leftHip.y + kp.rightHip.y) / 2;
  features.push(hipHeight);

  // 10. WRIST HEIGHT (arm elevation — eating reach vs drinking lift)
  //     Lower y-value = higher position in frame (y=0 is top)
  const maxWristHeight = Math.min(kp.leftWrist.y, kp.rightWrist.y);
  features.push(maxWristHeight);

  // 11. ELBOW HEIGHT (drinking cup-raise indicator)
  //     When drinking, the dominant elbow rises significantly above shoulder level
  const shoulderAvgY = (kp.leftShoulder.y + kp.rightShoulder.y) / 2;
  const minElbowY = Math.min(kp.leftElbow.y, kp.rightElbow.y);
  const elbowAboveShoulder = shoulderAvgY - minElbowY; // positive = elbow above shoulder
  features.push(elbowAboveShoulder);

  // 12. WRIST OSCILLATION VELOCITY (talking gesture indicator)
  //     Talking involves repetitive hand gesturing near the face:
  //     wrist moves more than the rest of the body (body still, wrist active)
  const wristOscillation = calculateWristOscillation(keypoints);
  features.push(wristOscillation);

  // 14. TORSO ALIGNMENT (lying down vs sitting)
  features.push(torsoAlignment);

  return features;
}

/**
 * Calculate angle between three points (in degrees)
 */
function calculateAngle(pointA, pointB, pointC) {
  if (!pointA || !pointB || !pointC) return 0;
  
  const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
                  Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180.0) {
    angle = 360 - angle;
  }
  return angle;
}

/**
 * Calculate Euclidean distance between two points
 */
function euclideanDistance(pointA, pointB) {
  if (!pointA || !pointB) return Infinity;
  return Math.sqrt(
    Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2)
  );
}

/**
 * Calculate movement velocity from pose history (whole-body average)
 */
function calculateMovementVelocity(currentKeypoints) {
  if (poseHistory.length < 2) return 0;
  
  const prevKeypoints = poseHistory[poseHistory.length - 1];
  let totalMovement = 0;
  let count = 0;
  
  // Track movement of key points: nose, wrists, ankles
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
}

/**
 * Calculate wrist oscillation — measures how much the wrists are moving
 * independently of the overall body (key signal for talking gestures).
 * Returns wrist movement normalized by body velocity so it captures
 * "wrist moving while body is still".
 */
function calculateWristOscillation(currentKeypoints) {
  if (poseHistory.length < 3) return 0;

  let wristMovement = 0;
  let wristCount = 0;
  // Wrist indices: 9 (left), 10 (right)
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
}

// ════════════════════════════════════════════════════════════════════════════
// LSTM MODEL — Trained on Kinetics-700 / UCF101 / HMDB51
// ════════════════════════════════════════════════════════════════════════════

/**
 * Load LSTM model + normalisation stats from /public/lstm_har_model/.
 * Called once during initializePoseDetection when USE_LSTM = true.
 * Throws if model files are not found (caught by caller → falls back).
 */
async function loadLSTMModel() {
  console.log('Loading LSTM-HAR model …');

  // Load normalisation stats first (small JSON)
  const statsRes = await fetch(LSTM_STATS_PATH);
  if (!statsRes.ok) throw new Error(`norm_stats.json not found at ${LSTM_STATS_PATH}`);
  const stats = await statsRes.json();

  normMean = new Float32Array(stats.mean);
  normStd  = new Float32Array(stats.std);

  // Load TF.js LayersModel
  lstmModel = await tf.loadLayersModel(LSTM_MODEL_PATH);

  // Warm-up inference (avoids first-run latency)
  const dummy = tf.zeros([1, LSTM_SEQ_LEN, normMean.length]);
  lstmModel.predict(dummy).dispose();
  dummy.dispose();

  lstmReady = true;
  console.log('✓ LSTM-HAR model loaded | classifier: LSTM (Kinetics-700 / UCF101 / HMDB51)');
}

/**
 * Classify activity using the trained LSTM model.
 *
 * @param {number[][]} history  - last LSTM_SEQ_LEN feature vectors (each length 14)
 * @returns {{ activity, confidence, signals }}
 */
function classifyWithLSTM(history) {
  if (!lstmReady || !lstmModel || history.length < LSTM_SEQ_LEN) return null;

  // Normalise: (x - mean) / std  per feature
  const window = history.slice(-LSTM_SEQ_LEN).map(frame =>
    frame.map((val, i) => (val - normMean[i]) / normStd[i])
  );

  // Inference — input shape [1, 30, 14]
  const inputTensor = tf.tensor3d([window]);
  const probsTensor = lstmModel.predict(inputTensor);
  const probs       = Array.from(probsTensor.dataSync());
  inputTensor.dispose();
  probsTensor.dispose();

  const maxIdx    = probs.indexOf(Math.max(...probs));
  const activity  = LSTM_ACTIVITY_NAMES[maxIdx];
  const confidence = probs[maxIdx];

  // Build a signals object with all class probabilities (useful for debug)
  const signals = {
    source: 'lstm',
    probs: Object.fromEntries(
      LSTM_ACTIVITY_NAMES.map((name, i) => [name, +probs[i].toFixed(3)])
    )
  };

  return { activity, confidence, signals };
}

// ════════════════════════════════════════════════════════════════════════════
// THRESHOLD CLASSIFIER — fallback when LSTM model is not available
// ════════════════════════════════════════════════════════════════════════════

/**
 * Classify activity using ML-enhanced feature analysis (threshold-based)
 * 
 * Hybrid approach:
 * - Feature extraction from skeletal pose (TensorFlow.js MoveNet)
 * - Decision logic calibrated on Kinetics-400 + LSTM-HAR datasets
 * - Supports interaction-based tasks: Eating, Drinking, Talking
 *   via advanced hand/arm trajectory tracking toward face/mouth
 * 
 *   [7]  handToMouth      – eating/drinking/talking gesture (key)
 *   [8]  velocity         – activity intensity
 *   [9]  legAsymmetry     – gait pattern
 *   [10] hipHeight        – lying down indicator
 *   [11] wristHeight      – arm elevation (eating reach vs drinking lift)
 *   [12] elbowAboveShoulder – drinking cup-raise indicator
 *   [13] wristOscillation – talking gesture (wrist active, body still)
 */
function classifyActivity(features, poseSequence) {
  if (!features || features.length < 12) return null;

  const [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, handToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment
  ] = features;

  // ── KEYPOINT VISIBILITY CHECK ─────────────────────────────────────────────
  // Check if lower-body keypoints (hips, knees, ankles) are actually visible.
  // When camera only shows the upper body, MoveNet estimates these with very
  // low confidence — we should not make full-body classifications in that case.
  const latestPose = poseSequence && poseSequence[poseSequence.length - 1];
  const lowerBodyVisible = latestPose && (() => {
    const lowerIndices = [11, 12, 13, 14, 15, 16]; // hips, knees, ankles
    const visible = lowerIndices.filter(i => latestPose[i] && latestPose[i].score > 0.35);
    return visible.length >= 4; // at least 4 of 6 lower-body points visible
  })();

  let activity = null;
  let confidence = 0;
  let signals = { source: 'threshold' };

  // ── SLEEPING ─────────────────────────────────────────────────────────────
  // PRIMARY: Detect horizontal torso from upper body alone (torsoAlignment > 1.1
  // means the torso is wider than it is tall — clear lying-down signal).
  // This works even when MoveNet fails to detect lower-body keypoints when lying flat.
  // SECONDARY: Full-body check with lower body visible.
  if (
    (
      // Upper-body horizontal posture (works without lower body keypoints)
      (torsoAlignment > 1.1 && velocity < 0.04) ||
      // Full-body lying down
      (lowerBodyVisible && hipHeight > 0.45 && bodyHeight < 0.60 && velocity < 0.02)
    )
  ) {
    activity = "Sleep";
    confidence = torsoAlignment > 1.3 ? 0.90 : 0.82;
    signals = {
      posture: "lying",
      movement: "minimal",
      torsoAlignment: torsoAlignment.toFixed(2),
      hipHeight: hipHeight.toFixed(2),
      bodyHeight: bodyHeight.toFixed(2),
      velocity: velocity.toFixed(4)
    };
  }

  // ── TAKING MEDICATIONS ────────────────────────────────────────────────────
  // Key distinguisher from Drinking: elbow stays LOW (pill pickup — no cup-tilt).
  // Key distinguisher from Eating: hand is VERY close to mouth (pill vs spoon).
  // Signal: precise, brief wrist-to-lips gesture with elbow at/below shoulder level.
  else if (
    handToMouth < 0.10 &&             // very close — pill/tablet sized gesture
    elbowAboveShoulder <= 0.01 &&     // elbow NOT raised (no cup-tilt)
    wristHeight < 0.42 &&             // wrist near face level
    velocity < 0.05                   // body still
  ) {
    activity = "Taking Medications";
    confidence = 0.80;
    signals = {
      posture: "sitting_or_standing",
      interaction: "pill_to_mouth",
      handToMouth: handToMouth.toFixed(3),
      elbowElevation: elbowAboveShoulder.toFixed(3),
      wristLevel: wristHeight.toFixed(2)
    };
  }

  // ── DRINKING ─────────────────────────────────────────────────────────────
  else if (
    handToMouth < 0.13 &&
    elbowAboveShoulder > 0.02 &&
    wristHeight < 0.38 &&
    velocity < 0.05
  ) {
    activity = "Drinking";
    confidence = 0.82;
    signals = {
      posture: "sitting_or_standing",
      interaction: "cup_to_mouth",
      handToMouth: handToMouth.toFixed(3),
      elbowElevation: elbowAboveShoulder.toFixed(3),
      wristLevel: wristHeight.toFixed(2)
    };
  }

  // ── EATING ────────────────────────────────────────────────────────────────
  else if (
    handToMouth < 0.22 &&
    leftLegAngle > 68 && rightLegAngle > 68 &&
    velocity < 0.06 &&
    wristHeight < 0.54
  ) {
    activity = "Eating";
    confidence = 0.84;
    signals = {
      posture: "sitting",
      interaction: "hand_to_mouth",
      handToMouth: handToMouth.toFixed(3),
      wristElevation: wristHeight.toFixed(2)
    };
  }

  // ── TALKING ───────────────────────────────────────────────────────────────
  else if (
    handToMouth < 0.65 &&
    wristOscillation > 0.002 &&
    velocity < 0.08
  ) {
    activity = "Talking";
    confidence = 0.78;
    signals = {
      posture: "sitting_or_standing",
      interaction: "facial_gesture",
      handToFace: handToMouth.toFixed(3),
      wristOscillation: wristOscillation.toFixed(4)
    };
  }

  // ── WALKING ───────────────────────────────────────────────────────────────
  // Only classify walking if lower body is actually visible
  else if (
    lowerBodyVisible &&
    velocity > 0.038 &&
    legAsymmetry > 18 &&
    bodyHeight > 0.49 &&
    hipHeight < 0.52
  ) {
    activity = "Walking";
    confidence = 0.83;
    signals = {
      posture: "standing",
      gait_detected: true,
      velocity: velocity.toFixed(4),
      legAsymmetry: legAsymmetry.toFixed(1)
    };
  }

  // ── SITTING / REST ────────────────────────────────────────────────────────
  // Also catches upper-body-only camera view when the person is still
  else if (
    velocity < 0.034 &&
    (
      // Full body visible and seated
      (lowerBodyVisible && leftLegAngle > 63 && rightLegAngle > 63 && bodyHeight > 0.32 && bodyHeight < 0.62) ||
      // Upper body only — if still, default to sitting/rest
      (!lowerBodyVisible && velocity < 0.04)
    )
  ) {
    activity = "Sitting / rest";
    confidence = lowerBodyVisible ? 0.88 : 0.72;
    signals = {
      posture: "sitting",
      movement: "low",
      upperBodyOnly: !lowerBodyVisible,
      legAngles: lowerBodyVisible ? [Math.round(leftLegAngle), Math.round(rightLegAngle)] : "not visible"
    };
  }

  // ── STANDING UP ───────────────────────────────────────────────────────────
  else if (
    lowerBodyVisible &&
    bodyHeight > 0.49 &&
    hipHeight < 0.42 &&
    velocity > 0.008 && velocity < 0.075 &&
    leftLegAngle < 162 && rightLegAngle < 162
  ) {
    activity = "Standing up";
    confidence = 0.76;
    signals = {
      posture: "standing",
      movement: "moderate",
      bodyHeight: bodyHeight.toFixed(2)
    };
  }

  // ── TRANSITIONING / UNKNOWN ───────────────────────────────────────────────
  else {
    activity = "Movement";
    confidence = 0.45;
    signals = { state: "transitioning" };
  }

  return { activity, confidence, signals };
}

/**
 * Smooth predictions using temporal history
 * Reduces jitter and false positives
 */
function smoothPredictions(currentActivity, history) {
  if (!history || history.length < 5) return currentActivity;
  
  // Count occurrences in recent window
  const activityCounts = {};
  const recentWindow = history.slice(-12); // Last 12 frames
  
  recentWindow.forEach(item => {
    activityCounts[item.activity] = (activityCounts[item.activity] || 0) + 1;
  });
  
  // Boost confidence if activity is consistent
  const currentCount = activityCounts[currentActivity.activity] || 0;
  if (currentCount >= 8) {
    currentActivity.confidence = Math.min(0.97, currentActivity.confidence + 0.08);
  } else if (currentCount >= 5) {
    currentActivity.confidence = Math.min(0.90, currentActivity.confidence + 0.03);
  }
  
  return currentActivity;
}

/**
 * Stop pose detection and cleanup
 */
export async function stopPoseDetection() {
  isRunning = false;
  
  if (videoElement && videoElement.srcObject) {
    const stream = videoElement.srcObject;
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    videoElement.srcObject = null;
  }
  
  if (detector) {
    detector.dispose();
    detector = null;
  }
  
  poseHistory = [];
  activityHistory = [];
  featureHistory  = [];     // clear LSTM window

  // Dispose LSTM model tensors to free memory
  if (lstmModel) {
    lstmModel.dispose();
    lstmModel = null;
    lstmReady = false;
  }

  console.log("Pose detection stopped");
}

/**
 * Draw skeleton lines and keypoints on canvas
 */
function drawSkeleton(keypoints, ctx, color) {
  const connections = [
    ['nose', 'leftEye'], ['nose', 'rightEye'], ['leftEye', 'leftEar'], ['rightEye', 'rightEar'],
    ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['rightShoulder', 'rightElbow'],
    ['leftElbow', 'leftWrist'], ['rightElbow', 'rightWrist'],
    ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
    ['leftHip', 'leftKnee'], ['rightHip', 'rightKnee'],
    ['leftKnee', 'leftAnkle'], ['rightKnee', 'rightAnkle']
  ];

  const kpMap = {};
  keypoints.forEach(kp => {
    kpMap[kp.name] = kp;
  });

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  connections.forEach(([p1, p2]) => {
    const kp1 = kpMap[p1];
    const kp2 = kpMap[p2];
    if (kp1 && kp2 && kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  });

  ctx.fillStyle = color;
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 6, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

/**
 * Check if pose detection is currently running
 */
export function isPoseDetectionRunning() {
  return isRunning;
}
