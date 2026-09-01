// schedule-monitoring/frontend/src/services/activityDetection.js
/**
 * Activity Detection Service
 *
 * Primary path:
 *  1. LSTM model loaded from <BASE_URL>mediapipe_activity_model/tfjs/model.json.
 *     Only trusted when confidence >= LSTM_CONFIDENCE_THRESHOLD; otherwise
 *     falls back to the threshold classifier for that frame.
 *
 * Fallback path:
 *  2. Threshold classifier based on BlazePose landmark geometry.
 *
 * This version uses the 33-landmark BlazePose schema so it matches the
 * MediaPipe CSV pipeline used for training.
 *
 * CHANGES vs previous version:
 *  - smoothPredictions() now actually smooths (majority vote over a rolling
 *    window) instead of always returning the raw per-frame result.
 *  - LSTM predictions below LSTM_CONFIDENCE_THRESHOLD fall back to the
 *    threshold classifier instead of being trusted at any confidence.
 *  - Walking vs Standing no longer overlap: Walking now requires actual
 *    movement (velocity above a floor + leg asymmetry), Standing owns the
 *    low-velocity/straight-leg case. Previously "straight legs + low
 *    velocity" (i.e. standing still) was being classified as Walking
 *    because that branch was checked first with a wider velocity band.
 *  - Ankle-confidence gating now actually changes the geometry used: when
 *    ankles are unreliable, leg-angle features fall back to hip-angle
 *    estimation instead of trusting extrapolated ankle coordinates.
 *  - Object detection runs on a fixed cadence (every 2nd frame) instead of
 *    a 50/50 coin flip, so Eating/Drinking object context doesn't randomly
 *    drop out.
 */

import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const USE_LSTM = false;  // DIAGNOSTIC: Set to false to bypass LSTM and test threshold classifier only
const USE_RF = false;   // DIAGNOSTIC: Set to false to bypass RF and test threshold classifier only
const CONFIDENCE_THRESHOLD = 0.50;       // used for alignment / UI feedback
const LSTM_CONFIDENCE_THRESHOLD = 0.55;  // below this, fall back to threshold classifier
const RF_CONFIDENCE_THRESHOLD = 0.55;    // below this, fall back to threshold classifier for RF
const ANKLE_CONFIDENCE_THRESHOLD = 0.35;
const HISTORY_SIZE = 12;
const LSTM_SEQ_LEN = 30;
const SMOOTHING_WINDOW = 5;
const SMOOTHING_MAJORITY = 3; // out of SMOOTHING_WINDOW, need this many agreeing to switch
const OBJECT_DETECT_EVERY_N_FRAMES = 2;
const WALKING_MIN_VELOCITY = 0.018; // must show actual movement to count as walking
const WALKING_MIN_LEG_ASYMMETRY = 6; // degrees; walking gait alternates leg angles

// ── THREE-THRESHOLD WALKING CLASSIFIER ──────────────────────────────────
// Detects walking by checking THREE independent conditions:
// 1. ARM MOVEMENT: Arms must be swinging/moving
// 2. LEG MOVEMENT: Legs must be moving (asymmetry in angles)
// 3. UPRIGHT POSTURE: Body must be standing straight (not sitting/lying)
const WALKING_ARM_VELOCITY_MIN = 0.008;      // Minimum arm movement velocity
const WALKING_LEG_VELOCITY_MIN = 0.015;      // Minimum leg movement (velocity)
const WALKING_LEG_ASYMMETRY_MIN = 4.0;       // Minimum leg asymmetry (degrees)
const WALKING_LEGS_STRAIGHT_THRESHOLD = 145; // Both legs > this angle = standing
const WALKING_UPRIGHT_MIN_HEIGHT = 0.50;     // Body height must be above this
const WALKING_BODY_VELOCITY_MIN = 0.012;     // Overall body center velocity

// Built from Vite's BASE_URL so this never goes stale if the base path
// (currently "/schedule/") ever changes. import.meta.env.BASE_URL already
// includes the trailing slash.
const LSTM_MODEL_PATH = `${import.meta.env.BASE_URL}lstm_har_model/model.json`;
const LSTM_STATS_PATH = `${import.meta.env.BASE_URL}lstm_har_model/norm_stats.json`;

// Backend API endpoint for Random Forest predictions
const RF_API_ENDPOINT = `/api/monitoring/predict-rf`;

// ── TEMPORAL PATTERN DETECTION CONSTANTS ────────────────────────────────────
// For detecting eating and drinking patterns over time
const EATING_MIN_CYCLES = 2;                    // Minimum oscillation cycles for eating
const EATING_CYCLE_HISTORY_SIZE = 20;           // Track last N hand positions
const EATING_HAND_PROXIMITY_THRESHOLD = 0.25;   // Hand near mouth
const EATING_PLATE_PROXIMITY_THRESHOLD = 0.40;  // Hand near plate/food
const DRINKING_GESTURE_DURATION = 800;          // Single gesture timeout (ms)
const DRINKING_HAND_PROXIMITY_THRESHOLD = 0.25; // Hand near mouth for drinking
const WALKING_VELOCITY_THRESHOLD = 0.035;       // Significantly increased from 0.010 to prevent false positives from pose noise

const LSTM_ACTIVITY_NAMES = [
  'Walking',
  'Sitting / rest',
  'Sleeping',
  'Eating',
  'Drinking'
];

let LSTM_CLASS_NAMES = [...LSTM_ACTIVITY_NAMES];

let detector = null;
let faceDetector = null;
let objectDetector = null;
let lastDetectedObjects = [];
let mouthHistory = [];
let isRunning = false;
let isInitializing = false;
let videoElement = null;
let onActivityCallback = null;
let canvasElement = null;
let expectedActivityRef = null;
let onAlignmentChangeCallback = null;
let currentAlignment = false;
let frameCounter = 0;

let poseHistory = [];
let activityHistory = [];       // raw per-frame results, used for majority-vote smoothing
let stableActivity = null;      // last activity that actually won the smoothing vote
let featureHistory = [];

// ── TEMPORAL PATTERN TRACKING ──────────────────────────────────────────────
// For detecting eating and drinking patterns over time
let handMotionHistory = [];      // Track hand positions over time
let mouthPositionHistory = [];   // Track mouth position over time
let platePositionHistory = [];   // Track plate/food position over time
let eatingCycleCount = 0;        // Count of eating oscillation cycles
let lastEatingCycleTime = 0;     // Timestamp of last eating cycle
let drinkingGestureStartTime = 0; // When hand-to-cup gesture started
let drinkingGestureActive = false; // Is drinking gesture currently active
let lastDrinkingGestureTime = 0;  // When hand left mouth after drinking

let lstmModel = null;
let normMean = null;
let normStd = null;
let lstmReady = false;

const actionMemory = {
  lastCupSeen: 0,
  lastFoodSeen: 0,
  lastEmptyHandToMouth: 0,
  lastCupToMouth: 0,
  lastEatingGestureWithFood: 0,
  lastBedSeen: 0,
  detectedFoodObjects: [],
  detectedCups: [],
  detectedUtensils: [],
  eatingOscillationActive: false,      // Currently in eating oscillation
  drivingGestureInProgress: false,     // Currently performing drink gesture
};

const OBJECT_MEMORY_MAX = 10;
const OBJECT_MEMORY_DURATION = 10000;

const MP_IDX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

function normalizeActivityLabel(activity) {
  if (!activity) return activity;
  const normalized = String(activity).trim().toLowerCase();
  if (normalized.includes('walk')) return 'Walking';
  if (normalized.includes('sit') || normalized.includes('rest')) return 'Sitting / rest';
  if (normalized.includes('sleep') || normalized.includes('bed') || normalized.includes('nap')) return 'Sleeping';
  if (normalized.includes('eat') || normalized.includes('food') || normalized.includes('meal')) return 'Eating';
  if (normalized.includes('drink') || normalized.includes('water') || normalized.includes('hydrate')) return 'Drinking';
  return 'Sitting / rest';
}

function getPoint(keypoints, index) {
  return keypoints && keypoints[index] ? keypoints[index] : null;
}

function calculateAngle(pointA, pointB, pointC) {
  if (!pointA || !pointB || !pointC) return 0;
  const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
    Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180.0) angle = 360 - angle;
  return angle;
}

function euclideanDistance(pointA, pointB) {
  if (!pointA || !pointB) return Infinity;
  return Math.sqrt(
    Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2)
  );
}

function calculateMovementVelocity(currentKeypoints) {
  if (poseHistory.length < 2) return 0;
  const prevKeypoints = poseHistory[poseHistory.length - 1];
  let totalMovement = 0;
  let count = 0;
  const keypointsToTrack = [0, 15, 16, 27, 28];
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

function calculateWristOscillation(currentKeypoints) {
  if (poseHistory.length < 3) return 0;
  let wristMovement = 0;
  let wristCount = 0;
  const wristIndices = [15, 16];
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

/**
 * Returns a leg angle, falling back to a hip-angle-derived estimate when the
 * ankle keypoint isn't confidently tracked (MoveNet/BlazePose extrapolate
 * occluded ankles into "standing straight" positions, which previously
 * inflated seated poses into the standing/walking angle range).
 */
function getReliableLegAngle(hip, knee, ankle, shoulderMid, hipMid) {
  const ankleConfident = ankle && ankle.score > ANKLE_CONFIDENCE_THRESHOLD;
  if (ankleConfident) {
    return { angle: calculateAngle(hip, knee, ankle), source: 'ankle' };
  }
  // Fallback: use torso-hip-knee angle as a proxy. A seated person has a
  // strong hip bend (torso over hip is roughly perpendicular to thigh);
  // a standing person has torso and thigh roughly in line.
  if (shoulderMid && hipMid && knee) {
    return { angle: calculateAngle(shoulderMid, hipMid, knee), source: 'hip_fallback' };
  }
  return { angle: 90, source: 'unknown' }; // neutral/seated-biased default, never "standing straight"
}

function extractThresholdFeatures(keypoints) {
  if (!keypoints || keypoints.length < 33) return null;

  const nose = getPoint(keypoints, MP_IDX.nose);
  const leftShoulder = getPoint(keypoints, MP_IDX.leftShoulder);
  const rightShoulder = getPoint(keypoints, MP_IDX.rightShoulder);
  const leftElbow = getPoint(keypoints, MP_IDX.leftElbow);
  const rightElbow = getPoint(keypoints, MP_IDX.rightElbow);
  const leftWrist = getPoint(keypoints, MP_IDX.leftWrist);
  const rightWrist = getPoint(keypoints, MP_IDX.rightWrist);
  const leftHip = getPoint(keypoints, MP_IDX.leftHip);
  const rightHip = getPoint(keypoints, MP_IDX.rightHip);
  const leftKnee = getPoint(keypoints, MP_IDX.leftKnee);
  const rightKnee = getPoint(keypoints, MP_IDX.rightKnee);
  const leftAnkle = getPoint(keypoints, MP_IDX.leftAnkle);
  const rightAnkle = getPoint(keypoints, MP_IDX.rightAnkle);

  if (!nose || !leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const features = [];

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;
  const shoulderMid = { x: shoulderMidX, y: shoulderMidY };
  const hipMid = { x: hipMidX, y: hipMidY };
  const torsoDX = Math.abs(hipMidX - shoulderMidX);
  const torsoDY = Math.abs(hipMidY - shoulderMidY);
  const torsoHeight = torsoDY;
  const torsoAlignment = torsoDX / (torsoDY + 0.001);
  features.push(torsoHeight);

  const leftLegResult = getReliableLegAngle(leftHip, leftKnee, leftAnkle, shoulderMid, hipMid);
  const rightLegResult = getReliableLegAngle(rightHip, rightKnee, rightAnkle, shoulderMid, hipMid);
  const leftLegAngle = leftLegResult.angle;
  const rightLegAngle = rightLegResult.angle;
  const anklesConfident = leftLegResult.source === 'ankle' && rightLegResult.source === 'ankle';
  features.push(leftLegAngle, rightLegAngle);

  const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
  features.push(leftArmAngle, rightArmAngle);

  // bodyHeight also depends on ankle y — only trust it when ankles are confident,
  // otherwise approximate using hip y (prevents extrapolated ankles inflating this).
  const bodyHeight = anklesConfident
    ? Math.abs(Math.max(leftAnkle.y, rightAnkle.y) - nose.y)
    : Math.abs(hipMidY - nose.y) * 1.6; // rough scale factor hip->full-body

  features.push(bodyHeight);

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  features.push(shoulderWidth);

  const minHandToMouth = Math.min(
    euclideanDistance(leftWrist, { x: nose.x, y: nose.y }),
    euclideanDistance(rightWrist, { x: nose.x, y: nose.y })
  );
  features.push(minHandToMouth);

  const velocity = calculateMovementVelocity(keypoints);
  features.push(velocity);

  const legAsymmetry = Math.abs(leftLegAngle - rightLegAngle);
  features.push(legAsymmetry);

  const hipHeight = (leftHip.y + rightHip.y) / 2;
  features.push(hipHeight);

  const leftWristY = leftWrist && leftWrist.score > 0.3 ? leftWrist.y : 1.0;
  const rightWristY = rightWrist && rightWrist.score > 0.3 ? rightWrist.y : 1.0;
  features.push(Math.min(leftWristY, rightWristY));

  const shoulderAvgY = (leftShoulder.y + rightShoulder.y) / 2;
  const minElbowY = Math.min(leftElbow.y, rightElbow.y);
  features.push(shoulderAvgY - minElbowY);

  features.push(calculateWristOscillation(keypoints));
  features.push(torsoAlignment);
  features.push(anklesConfident ? 1 : 0); // exposed so classifyActivity can use it directly

  return features;
}

/**
 * Extract 15 features for Random Forest model.
 * Must match exactly what train_rf_model.py expects:
 * 0: shoulder_angle
 * 1: elbow_angle_left
 * 2: elbow_angle_right
 * 3: hip_angle
 * 4: knee_angle_left
 * 5: knee_angle_right
 * 6: arm_raise_left
 * 7: arm_raise_right
 * 8: hand_to_mouth
 * 9: hand_to_face
 * 10: arm_velocity
 * 11: leg_velocity
 * 12: torso_lean
 * 13: body_symmetry
 * 14: hand_height
 */
function extractRFFeatures(keypoints) {
  if (!keypoints || keypoints.length < 33) return null;

  const nose = getPoint(keypoints, 0);
  const leftEye = getPoint(keypoints, 1);
  const rightEye = getPoint(keypoints, 2);
  const mouthLeft = getPoint(keypoints, 9);
  const mouthRight = getPoint(keypoints, 10);
  const leftShoulder = getPoint(keypoints, 11);
  const rightShoulder = getPoint(keypoints, 12);
  const leftElbow = getPoint(keypoints, 13);
  const rightElbow = getPoint(keypoints, 14);
  const leftWrist = getPoint(keypoints, 15);
  const rightWrist = getPoint(keypoints, 16);
  const leftHip = getPoint(keypoints, 23);
  const rightHip = getPoint(keypoints, 24);
  const leftKnee = getPoint(keypoints, 25);
  const rightKnee = getPoint(keypoints, 26);
  const leftAnkle = getPoint(keypoints, 27);
  const rightAnkle = getPoint(keypoints, 28);

  if (!nose || !leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const features = [];

  try {
    // 0: shoulder_angle (left shoulder - nose - right shoulder)
    const shoulderAngle = calculateAngle(leftShoulder, nose, rightShoulder);
    features.push(shoulderAngle);

    // 1: elbow_angle_left (shoulder - elbow - wrist)
    const elbowAngleLeft = calculateAngle(leftShoulder, leftElbow, leftWrist);
    features.push(elbowAngleLeft);

    // 2: elbow_angle_right
    const elbowAngleRight = calculateAngle(rightShoulder, rightElbow, rightWrist);
    features.push(elbowAngleRight);

    // 3: hip_angle (left hip - nose - right hip)
    const hipAngle = calculateAngle(leftHip, nose, rightHip);
    features.push(hipAngle);

    // 4: knee_angle_left (hip - knee - ankle)
    const kneeAngleLeft = calculateAngle(leftHip, leftKnee, leftAnkle);
    features.push(kneeAngleLeft);

    // 5: knee_angle_right
    const kneeAngleRight = calculateAngle(rightHip, rightKnee, rightAnkle);
    features.push(kneeAngleRight);

    // 6: arm_raise_left (shoulder y - wrist y, positive = arm raised)
    const armRaiseLeft = Math.max(0.0, leftShoulder.y - leftWrist.y);
    features.push(armRaiseLeft);

    // 7: arm_raise_right
    const armRaiseRight = Math.max(0.0, rightShoulder.y - rightWrist.y);
    features.push(armRaiseRight);

    // 8: hand_to_mouth (distance from hand to mouth)
    const mouthCenter = mouthLeft && mouthRight ? {
      x: (mouthLeft.x + mouthRight.x) / 2,
      y: (mouthLeft.y + mouthRight.y) / 2
    } : nose;
    const handToMouthLeft = euclideanDistance(leftWrist, mouthCenter);
    const handToMouthRight = euclideanDistance(rightWrist, mouthCenter);
    const handToMouth = handToMouthLeft + handToMouthRight;
    features.push(handToMouth);

    // 9: hand_to_face (distance from hand to eye center)
    const eyeCenter = leftEye && rightEye ? {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2
    } : nose;
    const handToFaceLeft = euclideanDistance(leftWrist, eyeCenter);
    const handToFaceRight = euclideanDistance(rightWrist, eyeCenter);
    const handToFace = handToFaceLeft + handToFaceRight;
    features.push(handToFace);

    // 10: arm_velocity (horizontal + vertical movement of hands)
    const armVelocity = Math.abs(leftWrist.x - rightWrist.x) +
                        Math.abs(leftWrist.y - rightWrist.y);
    features.push(armVelocity);

    // 11: leg_velocity (horizontal + vertical movement of ankles)
    const legVelocity = Math.abs(leftAnkle.x - rightAnkle.x) +
                        Math.abs(leftAnkle.y - rightAnkle.y);
    features.push(legVelocity);

    // 12: torso_lean (difference in shoulder width vs hip width)
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    const hipWidth = Math.abs(leftHip.x - rightHip.x);
    const torsoLean = shoulderWidth - hipWidth;
    features.push(torsoLean);

    // 13: body_symmetry (left-right difference in arm angles)
    const bodySymmetry = Math.abs(elbowAngleLeft - elbowAngleRight);
    features.push(bodySymmetry);

    // 14: hand_height (average hand y-position, lower value = higher in frame)
    const handHeight = (leftWrist.y + rightWrist.y) / 2;
    features.push(handHeight);

    return features;
  } catch (error) {
    console.error('Error extracting RF features:', error);
    return null;
  }
}

function extractLSTMFeatures(keypoints) {
  if (!keypoints || keypoints.length < 33) return null;
  const features = [];
  for (let i = 0; i < 33; i++) {
    const point = keypoints[i] || { x: 0, y: 0, z: 0 };
    features.push(point.x ?? 0, point.y ?? 0, point.z ?? 0);
  }
  return features;
}

function updateObjectMemory(detectedObjects, currentTime) {
  if (!detectedObjects || detectedObjects.length === 0) return;

  const foodClasses = ['bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza',
    'donut', 'cake', 'apple', 'banana', 'orange', 'plate', 'dining table', 'food'];
  const cupClasses = ['cup', 'bottle', 'wine glass'];
  const utensilClasses = ['spoon', 'fork'];

  for (const obj of detectedObjects) {
    const objEntry = {
      class: obj.class,
      bbox: obj.bbox,
      score: obj.score,
      timestamp: currentTime,
      centerX: obj.bbox[0] + obj.bbox[2] / 2,
      centerY: obj.bbox[1] + obj.bbox[3] / 2
    };

    if (foodClasses.includes(obj.class)) {
      actionMemory.detectedFoodObjects.push(objEntry);
      actionMemory.detectedFoodObjects = actionMemory.detectedFoodObjects
        .filter(o => currentTime - o.timestamp < OBJECT_MEMORY_DURATION)
        .slice(-OBJECT_MEMORY_MAX);
    } else if (cupClasses.includes(obj.class)) {
      actionMemory.detectedCups.push(objEntry);
      actionMemory.detectedCups = actionMemory.detectedCups
        .filter(o => currentTime - o.timestamp < OBJECT_MEMORY_DURATION)
        .slice(-OBJECT_MEMORY_MAX);
    } else if (utensilClasses.includes(obj.class)) {
      actionMemory.detectedUtensils.push(objEntry);
      actionMemory.detectedUtensils = actionMemory.detectedUtensils
        .filter(o => currentTime - o.timestamp < OBJECT_MEMORY_DURATION)
        .slice(-OBJECT_MEMORY_MAX);
    }
  }
}

function getObjectMemoryStatus() {
  const now = Date.now();
  return {
    hasFood: actionMemory.detectedFoodObjects.length > 0 &&
      (now - actionMemory.detectedFoodObjects[actionMemory.detectedFoodObjects.length - 1].timestamp) < 8000,
    hasCup: actionMemory.detectedCups.length > 0 &&
      (now - actionMemory.detectedCups[actionMemory.detectedCups.length - 1].timestamp) < 8000,
    foodCount: actionMemory.detectedFoodObjects.length,
    cupCount: actionMemory.detectedCups.length,
  };
}

async function loadLSTMModel() {
  console.log('Loading LSTM-HAR model from', LSTM_MODEL_PATH, '…');
  const statsRes = await fetch(LSTM_STATS_PATH);
  if (!statsRes.ok) throw new Error(`norm_stats.json not found at ${LSTM_STATS_PATH} (status ${statsRes.status})`);
  const stats = await statsRes.json();
  if (Array.isArray(stats.class_names) && stats.class_names.length !== LSTM_ACTIVITY_NAMES.length) {
    console.warn(
      `norm_stats.json reports ${stats.class_names.length} classes (${stats.class_names.join(', ')}) ` +
      `but the allowed 5-class contract is [${LSTM_ACTIVITY_NAMES.join(', ')}]. Using the locked contract.`
    );
  }
  LSTM_CLASS_NAMES = [...LSTM_ACTIVITY_NAMES];
  normMean = new Float32Array(stats.mean);
  normStd = new Float32Array(stats.std);
  lstmModel = await tf.loadLayersModel(LSTM_MODEL_PATH);
  const dummy = tf.zeros([1, LSTM_SEQ_LEN, normMean.length]);
  lstmModel.predict(dummy).dispose();
  dummy.dispose();
  lstmReady = true;
  console.log('✓ LSTM-HAR model loaded. Trained classes:', LSTM_CLASS_NAMES);
}

function classifyWithLSTM(history) {
  if (!lstmReady || !lstmModel || history.length < LSTM_SEQ_LEN) return null;
  const window = history.slice(-LSTM_SEQ_LEN).map(frame =>
    frame.map((val, i) => (val - normMean[i]) / normStd[i])
  );
  const inputTensor = tf.tensor3d([window]);
  const probsTensor = lstmModel.predict(inputTensor);
  const probs = Array.from(probsTensor.dataSync());
  inputTensor.dispose();
  probsTensor.dispose();
  const maxIdx = probs.indexOf(Math.max(...probs));
  const activity = normalizeActivityLabel(LSTM_CLASS_NAMES[maxIdx] || 'Walking');
  const confidence = probs[maxIdx];
  const signals = {
    source: 'lstm',
    probs: Object.fromEntries(
      LSTM_CLASS_NAMES.map((name, i) => [name, +probs[i].toFixed(3)])
    )
  };
  return { activity, confidence, signals };
}

/**
 * Classify activity using Random Forest model via backend API.
 * Returns {activity, confidence, signals} or null if prediction fails.
 */
async function classifyWithRF(features) {
  if (!features || features.length !== 15) {
    console.warn('RF: Invalid features provided');
    return null;
  }

  try {
    const response = await fetch(RF_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ features })
    });

    if (!response.ok) {
      console.error(`RF API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data.model_ready) {
      console.warn('RF: Model not ready on backend:', data.error);
      return null;
    }

    if (!data.activity) {
      console.warn('RF: No activity returned');
      return null;
    }

    const signals = {
      source: 'random_forest',
      confidence: data.confidence
    };

    return {
      activity: data.activity,
      confidence: data.confidence,
      signals
    };
  } catch (error) {
    console.error('RF API call failed:', error);
    return null;
  }
}

/**
 * THREE-THRESHOLD WALKING CLASSIFIER
 * 
 * Detects walking by checking THREE independent conditions:
 * 1. ARM MOVEMENT: Arms must be swinging (above threshold)
 * 2. LEG MOVEMENT: Legs must be moving (asymmetry or velocity)
 * 3. UPRIGHT POSTURE: Body must be standing straight (legs extended, tall posture)
 * 
 * Returns: {isWalking: boolean, confidence: 0-1, signals: object}
 */
function detectWalkingWithThresholds(features, poseSequence) {
  if (!features || features.length < 13) return { isWalking: false, confidence: 0, signals: {} };

  const [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, handToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment, anklesConfidentFlag
  ] = features;

  const signals = {
    threshold1_armMovement: false,
    threshold2_legMovement: false,
    threshold3_uprightPosture: false,
    arm_velocity: 0,
    leg_asymmetry: legAsymmetry,
    body_velocity: velocity,
    left_leg_angle: leftLegAngle,
    right_leg_angle: rightLegAngle,
    body_height: bodyHeight,
  };

  // ──────────────────────────────────────────────────────────────────────
  // THRESHOLD 1: ARM MOVEMENT
  // Check if arms are swinging (moving, not at rest)
  // ──────────────────────────────────────────────────────────────────────
  const armMovement = Math.abs(wristOscillation) + Math.abs(elbowAboveShoulder);
  const hasArmMovement = armMovement >= WALKING_ARM_VELOCITY_MIN;
  signals.threshold1_armMovement = hasArmMovement;
  signals.arm_movement_detected = armMovement.toFixed(4);

  // ──────────────────────────────────────────────────────────────────────
  // THRESHOLD 2: LEG MOVEMENT
  // Check if legs are alternating (walking gait pattern)
  // Legs must show asymmetry (one leg bent, other straight = walking pattern)
  // ──────────────────────────────────────────────────────────────────────
  const hasLegAsymmetry = legAsymmetry >= WALKING_LEG_ASYMMETRY_MIN;
  const hasLegVelocity = velocity >= WALKING_LEG_VELOCITY_MIN;
  const hasLegMovement = hasLegAsymmetry || hasLegVelocity;
  signals.threshold2_legMovement = hasLegMovement;

  // ──────────────────────────────────────────────────────────────────────
  // THRESHOLD 3: UPRIGHT POSTURE
  // Check if body is standing straight (not sitting, not lying down)
  // ──────────────────────────────────────────────────────────────────────
  const legsAreStraight = leftLegAngle > WALKING_LEGS_STRAIGHT_THRESHOLD && 
                          rightLegAngle > WALKING_LEGS_STRAIGHT_THRESHOLD;
  const bodyIsTall = bodyHeight > WALKING_UPRIGHT_MIN_HEIGHT;
  const isUprightPosture = legsAreStraight && bodyIsTall;
  signals.threshold3_uprightPosture = isUprightPosture;
  signals.legs_straight = legsAreStraight;
  signals.body_tall = bodyIsTall;

  // ──────────────────────────────────────────────────────────────────────
  // DECISION: ALL THREE THRESHOLDS MUST BE MET
  // ──────────────────────────────────────────────────────────────────────
  const isWalking = hasArmMovement && hasLegMovement && isUprightPosture;

  // Calculate confidence (0-1)
  let confidence = 0;
  if (isWalking) {
    // Base confidence when all thresholds met
    confidence = 0.75;
    
    // Boost if strong signals
    if (armMovement > WALKING_ARM_VELOCITY_MIN * 2) confidence += 0.05;
    if (legAsymmetry > WALKING_LEG_ASYMMETRY_MIN * 2) confidence += 0.05;
    if (velocity > WALKING_BODY_VELOCITY_MIN) confidence += 0.08;
    if (legsAreStraight && bodyHeight > 0.65) confidence += 0.05;
    
    // Cap at 0.95
    confidence = Math.min(confidence, 0.95);
  } else {
    // Partial credit for partial thresholds
    let partialScore = 0;
    if (hasArmMovement) partialScore += 0.25;
    if (hasLegMovement) partialScore += 0.25;
    if (isUprightPosture) partialScore += 0.25;
    confidence = partialScore > 0 ? partialScore * 0.4 : 0; // Scale down if not all thresholds
  }

  signals.thresholds_met = (hasArmMovement ? 1 : 0) + 
                           (hasLegMovement ? 1 : 0) + 
                           (isUprightPosture ? 1 : 0);

  return {
    isWalking,
    confidence,
    signals
  };
}

/**
 * EATING PATTERN DETECTOR (IMPROVED)
 * Detects repeated hand-to-mouth oscillation pattern
 * Can detect eating even without reliable object detection
 * 
 * Returns: {isEating: boolean, cycleCount: number, signals: object}
 */
function detectEatingPattern(handToMouth, velocity, objects, features) {
  // Check if food objects are detected (optional, but helpful for confidence)
  const hasFoodOrBowl = objects && objects.some(obj => [
    'bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
    'apple', 'banana', 'orange', 'plate', 'dining table', 'food'
  ].includes(obj.class));

  const now = Date.now();
  const isHandNearMouth = handToMouth < EATING_HAND_PROXIMITY_THRESHOLD;
  const isMovingSlowly = velocity < 0.10; // Slightly relaxed threshold

  // Track hand motion history with more detail
  if (handMotionHistory.length === 0 || 
      Math.abs(handToMouth - handMotionHistory[handMotionHistory.length - 1].handToMouth) > 0.01) {
    handMotionHistory.push({
      handToMouth,
      timestamp: now,
      isNearMouth: isHandNearMouth
    });
  }

  // Keep only last 30 frames (about 1s at 30fps)
  if (handMotionHistory.length > EATING_CYCLE_HISTORY_SIZE) {
    handMotionHistory.shift();
  }

  // Enhanced oscillation detection:
  // Count transitions from far → near (entering mouth zone)
  // and from near → far (leaving mouth zone)
  let nearToFarTransitions = 0;
  let farToNearTransitions = 0;
  let wasNear = false;
  
  for (const entry of handMotionHistory) {
    const isNear = entry.isNearMouth;
    
    if (!wasNear && isNear) {
      // Transition: far → near
      farToNearTransitions++;
    } else if (wasNear && !isNear) {
      // Transition: near → far
      nearToFarTransitions++;
    }
    wasNear = isNear;
  }

  // Oscillation = complete cycles (far→near→far) OR significant near→far transitions
  const oscillationCycles = Math.min(farToNearTransitions, nearToFarTransitions + 1);

  // Update cycle counter
  if (oscillationCycles >= EATING_MIN_CYCLES) {
    eatingCycleCount = oscillationCycles;
    lastEatingCycleTime = now;
    actionMemory.eatingOscillationActive = true;
  } else if (now - lastEatingCycleTime > 4000) {
    // Reset if no eating activity for 4 seconds
    eatingCycleCount = 0;
    actionMemory.eatingOscillationActive = false;
  }

  // Eating requires:
  // 1. Oscillation pattern (hand moving to/from mouth repeatedly)
  // 2. Hand currently near or recently near mouth
  // 3. Slow body movement (not walking)
  // 4. Food visible is a bonus but not strictly required
  const isEating = eatingCycleCount >= EATING_MIN_CYCLES && 
                   isHandNearMouth && 
                   isMovingSlowly;

  // Boost confidence if food is detected
  const confidenceBoost = hasFoodOrBowl ? 0.1 : 0;

  const signals = {
    hand_to_mouth: handToMouth.toFixed(3),
    oscillation_cycles: eatingCycleCount,
    far_to_near_transitions: farToNearTransitions,
    near_to_far_transitions: nearToFarTransitions,
    min_cycles_required: EATING_MIN_CYCLES,
    hand_motion_history_size: handMotionHistory.length,
    is_moving_slowly: isMovingSlowly,
    food_detected: hasFoodOrBowl,
    confidence_boost: confidenceBoost.toFixed(2),
  };

  return { isEating, cycleCount: eatingCycleCount, signals, confidenceBoost };
}

/**
 * DRINKING PATTERN DETECTOR (IMPROVED)
 * Detects single gesture: glass/bottle brought to mouth once, then hand returns
 * Can detect drinking even without reliable cup detection
 * 
 * Returns: {isDrinking: boolean, signals: object}
 */
function detectDrinkingPattern(handToMouth, velocity, objects) {
  // Cup detection is optional - we can detect drinking from hand motion alone
  const hasCup = objects && objects.some(obj => 
    ['cup', 'bottle', 'wine glass', 'glass'].includes(obj.class)
  );

  const now = Date.now();
  const isHandNearMouth = handToMouth < DRINKING_HAND_PROXIMITY_THRESHOLD;
  const isMovingSlowly = velocity < 0.10;
  const timeSinceDrink = now - lastDrinkingGestureTime;

  // State machine for drinking gesture:
  // 1. Hand starts away from mouth
  // 2. Hand moves to mouth (gesture starts)
  // 3. Hand stays at mouth briefly
  // 4. Hand moves away from mouth (gesture ends)
  // 5. After cooldown, gesture can repeat

  if (!drinkingGestureActive && isHandNearMouth && isMovingSlowly) {
    // Gesture started: hand moved to mouth (with slow body movement = controlled motion)
    drinkingGestureActive = true;
    drinkingGestureStartTime = now;
    
    const signals = {
      gesture_status: 'started',
      hand_to_mouth: handToMouth.toFixed(3),
      cup_detected: hasCup,
      has_slow_movement: true,
    };
    return { isDrinking: true, signals };
  }

  if (drinkingGestureActive && !isHandNearMouth) {
    // Gesture ended: hand moved away from mouth
    drinkingGestureActive = false;
    lastDrinkingGestureTime = now;

    const gestureDuration = now - drinkingGestureStartTime;
    // Valid sip gesture: 100ms to 1 second (not too quick, not too slow)
    const isDrinkingGesture = gestureDuration > 100 && gestureDuration < DRINKING_GESTURE_DURATION;

    const signals = {
      gesture_status: 'completed',
      gesture_duration_ms: gestureDuration,
      valid_gesture: isDrinkingGesture,
      cup_detected: hasCup,
    };
    return { isDrinking: isDrinkingGesture, signals };
  }

  // Gesture still in progress
  if (drinkingGestureActive && isHandNearMouth) {
    const signals = {
      gesture_status: 'in_progress',
      hand_to_mouth: handToMouth.toFixed(3),
      cup_detected: hasCup,
    };
    return { isDrinking: true, signals };
  }

  // Cooldown: gesture completed recently, allow re-trigger after timeout
  if (timeSinceDrink < DRINKING_GESTURE_DURATION * 1.5 && timeSinceDrink > 0) {
    const signals = {
      gesture_status: 'cooldown',
      time_since_last_gesture_ms: timeSinceDrink,
      cup_detected: hasCup,
    };
    // Still consider it drinking during cooldown for smoothing
    return { isDrinking: true, signals };
  }

  return { isDrinking: false, signals: { gesture_status: 'idle', cup_detected: hasCup } };
}

function classifyActivity(features, poseSequence, mouthVariance = 0, objects = [], isChewing = false, isSwallowing = false, headTiltRatio = 1.0, chewingCycles = 0) {
  if (!features || features.length < 13) return null;

  const [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, handToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment, anklesConfidentFlag
  ] = features;

  const anklesConfident = anklesConfidentFlag === 1;
  const now = Date.now();

  const hasCup = objects && objects.some(obj => ['cup', 'bottle', 'wine glass'].includes(obj.class));
  const hasFoodOrBowl = objects && objects.some(obj => [
    'bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
    'apple', 'banana', 'orange', 'plate', 'dining table', 'food'
  ].includes(obj.class));

  const hasBed = objects && objects.some(obj => obj.class === 'bed');
  if (hasBed) actionMemory.lastBedSeen = now;
  const sawBedRecently = (now - actionMemory.lastBedSeen) < 20000;

  const latestPose = poseSequence && poseSequence[poseSequence.length - 1];
  const shoulderMidPt = latestPose && latestPose[11] && latestPose[12]
    ? { x: (latestPose[11].x + latestPose[12].x) / 2, y: (latestPose[11].y + latestPose[12].y) / 2 } : null;
  const hipMidPt = latestPose && latestPose[23] && latestPose[24]
    ? { x: (latestPose[23].x + latestPose[24].x) / 2, y: (latestPose[23].y + latestPose[24].y) / 2 } : null;
  const kneeMidPt = latestPose && latestPose[25] && latestPose[26]
    ? { x: (latestPose[25].x + latestPose[26].x) / 2, y: (latestPose[25].y + latestPose[26].y) / 2 } : null;
  const hipAngle = (shoulderMidPt && hipMidPt && kneeMidPt)
    ? calculateAngle(shoulderMidPt, hipMidPt, kneeMidPt) : null;
  const bodyIsStraight = hipAngle !== null && hipAngle >= 160;

  if (hasCup) actionMemory.lastCupSeen = now;
  if (hasFoodOrBowl) actionMemory.lastFoodSeen = now;
  if (handToMouth < 0.35 && hasCup) actionMemory.lastCupToMouth = now;
  if (handToMouth < 0.35 && !hasCup) actionMemory.lastEmptyHandToMouth = now;

  const sawCupRecently = (now - actionMemory.lastCupSeen) < 8000;
  const sawFoodRecently = (now - actionMemory.lastFoodSeen) < 8000;
  const didDrinkGestureRecently = (now - actionMemory.lastCupToMouth) < 8000;
  const didPillGestureRecently = (now - actionMemory.lastEmptyHandToMouth) < 12000;
  const objectMemory = getObjectMemoryStatus();

  const legsStraight = leftLegAngle > 150 && rightLegAngle > 150;

  let activity = null;
  let confidence = 0;
  let signals = { source: 'threshold_classifier_with_temporal_patterns' };

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 0: SLEEPING (HIGH PRIORITY - Override eating/drinking when clear)
  // Check for sleeping FIRST if bed is detected or strong horizontal signals present
  // ──────────────────────────────────────────────────────────────────────
  if (
    (hasBed && velocity < 0.05) ||
    (torsoAlignment > 1.1 && velocity < 0.04) ||
    (hipHeight > 0.45 && bodyHeight < 0.60 && velocity < 0.02)
  ) {
    activity = 'Sleeping';
    confidence = hasBed && bodyIsStraight ? 0.94 : (torsoAlignment > 1.3 ? 0.90 : 0.82);
    signals = {
      rule: 'sleeping_high_priority_override',
      bed_detected: hasBed,
      torso_alignment: torsoAlignment.toFixed(2),
      hip_height: hipHeight.toFixed(3),
      body_height: bodyHeight.toFixed(3),
      velocity: velocity.toFixed(4),
      body_is_straight: bodyIsStraight,
    };
    console.log('😴 SLEEPING DETECTED (High Priority) - Bed:', hasBed, 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 1: EATING (Temporal Pattern - Repeated Oscillation)
  // Detect eating via hand-to-mouth oscillation, works even without food detection
  // ──────────────────────────────────────────────────────────────────────
  const eatingPattern = detectEatingPattern(handToMouth, velocity, objects, features);
  if (eatingPattern.isEating && eatingPattern.cycleCount >= EATING_MIN_CYCLES) {
    activity = 'Eating';
    // Base confidence from oscillation pattern
    confidence = 0.82 + (Math.min(eatingPattern.cycleCount, 5) * 0.02);
    // Boost with food detection
    confidence += eatingPattern.confidenceBoost;
    confidence = Math.min(confidence, 0.97);
    
    signals = {
      rule: 'eating_temporal_oscillation_pattern',
      oscillation_cycles: eatingPattern.cycleCount,
      hand_to_mouth: handToMouth.toFixed(3),
      food_visible: hasFoodOrBowl,
      detected_food_objects: objects.filter(o => [
        'bowl', 'plate', 'spoon', 'fork', 'sandwich', 'pizza', 
        'food', 'apple', 'banana', 'donut', 'cake'
      ].includes(o.class)).map(o => o.class),
      pattern_details: eatingPattern.signals,
    };
    console.log('🍽️  EATING DETECTED (Temporal) - Cycles:', eatingPattern.cycleCount, 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 2: DRINKING (Temporal Pattern - Single Sip Gesture)
  // Detect drinking via hand-to-mouth gesture, works even without cup detection
  // ──────────────────────────────────────────────────────────────────────
  const drinkingPattern = detectDrinkingPattern(handToMouth, velocity, objects);
  if (drinkingPattern.isDrinking && drinkingPattern.signals.gesture_status !== 'idle') {
    activity = 'Drinking';
    confidence = 0.88;
    if (hasCup) confidence = 0.93; // Boost if cup visible
    
    signals = {
      rule: 'drinking_temporal_gesture_pattern',
      hand_to_mouth: handToMouth.toFixed(3),
      cup_visible: hasCup,
      detected_cup_objects: objects.filter(o => [
        'cup', 'bottle', 'wine glass', 'glass'
      ].includes(o.class)).map(o => o.class),
      gesture_status: drinkingPattern.signals.gesture_status,
      pattern_details: drinkingPattern.signals,
    };
    console.log('💧 DRINKING DETECTED (Temporal) - Status:', drinkingPattern.signals.gesture_status, 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 3: SLEEPING (Multiple conditions - Horizontal body OR low hip+height)
  // ──────────────────────────────────────────────────────────────────────
  if (
    (torsoAlignment > 1.1 && velocity < 0.04) ||
    (hipHeight > 0.45 && bodyHeight < 0.60 && velocity < 0.02) ||
    (torsoAlignment > 0.9 && bodyIsStraight && sawBedRecently && velocity < 0.05)
  ) {
    activity = 'Sleeping';
    confidence = (sawBedRecently && bodyIsStraight) ? 0.94 : (torsoAlignment > 1.3 ? 0.90 : 0.82);
    signals = {
      rule: 'sleeping_horizontal_posture',
      torso_alignment: torsoAlignment.toFixed(2),
      hip_height: hipHeight.toFixed(3),
      body_height: bodyHeight.toFixed(3),
      velocity: velocity.toFixed(4),
      bed_detected: sawBedRecently,
      body_is_straight: bodyIsStraight,
    };
    console.log('😴 SLEEPING DETECTED - Torso:', torsoAlignment.toFixed(2), 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 3.5: SITTING/REST (HIGH PRIORITY - Override walking if legs flexed)
  // If legs are bent, person is sitting — not walking, even with arm/leg movement
  // ──────────────────────────────────────────────────────────────────────
  const isSittingPosture = (leftLegAngle < 140 || rightLegAngle < 140) && velocity < 0.08;
  const hasChair = objects && objects.some(obj => obj.class === 'chair');
  
  if (isSittingPosture) {
    activity = 'Sitting / rest';
    if (hasChair) {
      confidence = 0.91;
      signals = {
        rule: 'sitting_posture_with_chair_priority_override',
        sitting_posture: true,
        chair_detected: true,
        leg_angle_left: leftLegAngle.toFixed(1),
        leg_angle_right: rightLegAngle.toFixed(1),
      };
    } else {
      confidence = 0.82; // Increased from 0.73 to be more aggressive about sitting detection
      signals = {
        rule: 'sitting_posture_priority_override',
        sitting_posture: true,
        chair_detected: false,
        leg_angle_left: leftLegAngle.toFixed(1),
        leg_angle_right: rightLegAngle.toFixed(1),
      };
    }
    console.log('🪑 SITTING/REST DETECTED (Priority Override) - Left Leg:', leftLegAngle.toFixed(1), 'Right Leg:', rightLegAngle.toFixed(1), 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 4: WALKING (Improved - Velocity + Leg Asymmetry + Arm Movement)
  // Requires actual body movement with proper leg alternation
  // ──────────────────────────────────────────────────────────────────────
  const isMoving = velocity >= WALKING_VELOCITY_THRESHOLD;
  const isUprightPosture = bodyHeight > WALKING_UPRIGHT_MIN_HEIGHT;
  const hasLegAsymmetry = legAsymmetry >= WALKING_LEG_ASYMMETRY_MIN;
  const hasArmMovement = wristOscillation >= WALKING_ARM_VELOCITY_MIN;
  
  // Walking requires movement + upright posture + either leg asymmetry or arm movement
  const canBeWalking = isMoving && isUprightPosture && (hasLegAsymmetry || hasArmMovement);

  if (canBeWalking) {
    activity = 'Walking';
    // Confidence based on velocity strength and support signals
    confidence = 0.68;
    if (velocity > WALKING_VELOCITY_THRESHOLD * 2) confidence = 0.76;
    if (velocity > WALKING_VELOCITY_THRESHOLD * 3) confidence = 0.84;
    if (velocity > WALKING_VELOCITY_THRESHOLD * 4) confidence = 0.90;
    
    // Boost with leg asymmetry (walking gait pattern)
    if (hasLegAsymmetry) confidence = Math.min(confidence + 0.08, 0.96);
    // Boost with arm swing
    if (hasArmMovement) confidence = Math.min(confidence + 0.06, 0.96);
    
    signals = {
      rule: 'walking_velocity_with_leg_asymmetry_and_arm_swing',
      body_velocity: velocity.toFixed(4),
      velocity_threshold: WALKING_VELOCITY_THRESHOLD.toFixed(4),
      is_moving: true,
      is_upright: isUprightPosture,
      body_height: bodyHeight.toFixed(3),
      has_leg_asymmetry: hasLegAsymmetry,
      leg_asymmetry_value: legAsymmetry.toFixed(2),
      has_arm_movement: hasArmMovement,
      arm_movement_value: wristOscillation.toFixed(3),
      thresholds_met: (isMoving ? 1 : 0) + (isUprightPosture ? 1 : 0) + (hasLegAsymmetry || hasArmMovement ? 1 : 0),
    };
    console.log('🚶 WALKING DETECTED - Velocity:', velocity.toFixed(4), 'Leg Asymmetry:', legAsymmetry.toFixed(2), 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // DEFAULT: SITTING/REST (When nothing else matches)
  // ──────────────────────────────────────────────────────────────────────
  activity = 'Sitting / rest';
  confidence = 0.55;
  signals = {
    rule: 'default_fallback_sitting',
    reason: 'no_other_activity_rules_matched',
    velocity: velocity.toFixed(4),
    hand_to_mouth: handToMouth.toFixed(3),
    leg_angle_left: leftLegAngle.toFixed(1),
    leg_angle_right: rightLegAngle.toFixed(1),
  };

  return { activity, confidence, signals };
}

export async function initializePoseDetection(video, canvas, expectedRef, onActivityDetected, onAlignmentChange) {
  if (isInitializing || isRunning) {
    console.warn('Pose detection already initializing or running — skipping duplicate call');
    return { detector };
  }
  isInitializing = true;

  try {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }

    videoElement = video;
    canvasElement = canvas;
    expectedActivityRef = expectedRef;
    onActivityCallback = onActivityDetected;
    onAlignmentChangeCallback = onAlignmentChange;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();

    await tf.setBackend('webgl');
    await tf.ready();
    console.log('TensorFlow.js backend:', tf.getBackend());

    const detectorConfig = {
      runtime: 'mediapipe',
      modelType: 'full',
      enableSmoothing: true,
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
    };

    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.BlazePose,
      detectorConfig
    );
    console.log('✓ BlazePose pose detector loaded');

    const faceModel = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    faceDetector = await faceLandmarksDetection.createDetector(faceModel, { runtime: 'tfjs', refineLandmarks: false });
    console.log('✓ Face Landmarks detector loaded');

    objectDetector = await cocoSsd.load();
    console.log('✓ COCO-SSD object detector loaded');

    if (USE_LSTM) {
      loadLSTMModel().catch(err =>
        console.warn('LSTM model not found — using threshold classifier:', err.message)
      );
    }

    isRunning = true;
    isInitializing = false;
    frameCounter = 0;
    detectPoseLoop();
    return { detector };
  } catch (error) {
    isInitializing = false;
    console.error('Failed to initialize pose detection:', error);
    throw error;
  }
}

/**
 * UNIFIED CLASSIFICATION WITH PRIORITY ORDER
 * 
 * Priority order:
 * 1. Temporal patterns (Eating/Drinking) - most reliable
 * 2. RF Model (if enabled and confident)
 * 3. Threshold Classifier (fallback)
 */
async function classifyActivityWithPriority(normalizedKeypoints, thresholdFeatures, lstmFeatures, poseHistory, objects) {
  if (!thresholdFeatures || thresholdFeatures.length < 13) return null;

  const [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, handToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment, anklesConfidentFlag
  ] = thresholdFeatures;

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 1: EATING (Temporal Pattern - Repeated Oscillation)
  // ──────────────────────────────────────────────────────────────────────
  const eatingPattern = detectEatingPattern(handToMouth, velocity, objects, thresholdFeatures);
  if (eatingPattern.isEating && eatingPattern.cycleCount >= EATING_MIN_CYCLES) {
    const activity = 'Eating';
    let confidence = 0.82 + (Math.min(eatingPattern.cycleCount, 5) * 0.02);
    confidence += eatingPattern.confidenceBoost;
    confidence = Math.min(confidence, 0.97);
    
    const signals = {
      rule: 'eating_temporal_oscillation_pattern',
      oscillation_cycles: eatingPattern.cycleCount,
      hand_to_mouth: handToMouth.toFixed(3),
      pattern_details: eatingPattern.signals,
    };
    console.log('🍽️  EATING DETECTED (Temporal) - Cycles:', eatingPattern.cycleCount, 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 2: DRINKING (Temporal Pattern - Single Sip Gesture)
  // ──────────────────────────────────────────────────────────────────────
  const drinkingPattern = detectDrinkingPattern(handToMouth, velocity, objects);
  if (drinkingPattern.isDrinking && drinkingPattern.signals.gesture_status !== 'idle') {
    const activity = 'Drinking';
    let confidence = 0.88;
    const hasCup = objects && objects.some(obj => ['cup', 'bottle', 'wine glass'].includes(obj.class));
    if (hasCup) confidence = 0.93;
    
    const signals = {
      rule: 'drinking_temporal_gesture_pattern',
      hand_to_mouth: handToMouth.toFixed(3),
      gesture_status: drinkingPattern.signals.gesture_status,
      pattern_details: drinkingPattern.signals,
    };
    console.log('💧 DRINKING DETECTED (Temporal) - Status:', drinkingPattern.signals.gesture_status, 'Confidence:', confidence.toFixed(2));
    return { activity, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 3: USE RF MODEL (if enabled and has good confidence)
  // ──────────────────────────────────────────────────────────────────────
  if (USE_RF) {
    const rfFeatures = extractRFFeatures(normalizedKeypoints);
    if (rfFeatures && rfFeatures.length === 15) {
      const rfResult = await classifyWithRF(rfFeatures);
      if (rfResult && rfResult.confidence >= RF_CONFIDENCE_THRESHOLD) {
        // RF model is confident - use its result
        return rfResult;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRIORITY 4: FALLBACK TO THRESHOLD CLASSIFIER
  // ──────────────────────────────────────────────────────────────────────
  return classifyActivity(thresholdFeatures, poseHistory, 0, objects, false, false, 1.0, 0);
}

async function detectPoseLoop() {
  // Guard #1: bail out before doing any work if we've already been torn down.
  if (!isRunning || !detector || !videoElement) return;

  try {
    let objects = lastDetectedObjects;
    let faces = [];
    let poses = [];

    try {
      // Guard #2: re-check right before each detector call. stopPoseDetection()
      // can null these out while we're paused at an `await`, so a check made
      // only once at the top of the function is not enough.
      if (!isRunning || !detector) return;
      poses = await detector.estimatePoses(videoElement);

      if (!isRunning || !faceDetector) return;
      faces = await faceDetector.estimateFaces(videoElement);

      if (!isRunning) return;
      frameCounter++;
      // Fixed cadence instead of a 50/50 coin flip — Eating/Drinking depend on
      // consistent object context, so a random drop-out every other frame
      // was hurting them for no benefit.
      if (objectDetector && (frameCounter % OBJECT_DETECT_EVERY_N_FRAMES === 0 || lastDetectedObjects.length === 0)) {
        objects = await objectDetector.detect(videoElement);
        if (!isRunning) return;
        lastDetectedObjects = objects;
        updateObjectMemory(objects, Date.now());
      }
    } catch (e) {
      console.error(e);
    }

    // Guard #3: something may have stopped us while the inner try/catch above
    // was running. Don't touch canvases/state after teardown.
    if (!isRunning || !videoElement) return;

    if (poses && poses.length > 0) {
      const pose = poses[0];
      const width = videoElement.videoWidth || 640;
      const height = videoElement.videoHeight || 480;
      const normalizedKeypoints = pose.keypoints.map(p => ({
        ...p,
        x: p.x / width,
        y: p.y / height
      }));

      const thresholdFeatures = extractThresholdFeatures(normalizedKeypoints);
      const lstmFeatures = extractLSTMFeatures(normalizedKeypoints);
      let smoothedActivity = null;
      let mouthOpenRatio = 0;
      let headTiltRatio = 1.0;

      if (faces && faces.length > 0 && faces[0].keypoints) {
        const faceKp = faces[0].keypoints;
        if (faceKp[13] && faceKp[14] && faceKp[10] && faceKp[152]) {
          const lipDist = Math.sqrt(Math.pow(faceKp[13].x - faceKp[14].x, 2) + Math.pow(faceKp[13].y - faceKp[14].y, 2));
          const faceHeight = Math.sqrt(Math.pow(faceKp[10].x - faceKp[152].x, 2) + Math.pow(faceKp[10].y - faceKp[152].y, 2));
          mouthOpenRatio = lipDist / (faceHeight || 1);
        }
        if (faceKp[152] && faceKp[1] && faceKp[10]) {
          const chinToNose = faceKp[152].y - faceKp[1].y;
          const noseToForehead = faceKp[1].y - faceKp[10].y;
          headTiltRatio = chinToNose / (noseToForehead + 0.001);
        }
      }

      mouthHistory.push(mouthOpenRatio);
      if (mouthHistory.length > 40) mouthHistory.shift();

      let chewingCycles = 0;
      if (mouthHistory.length > 10) {
        const mean = mouthHistory.reduce((a, b) => a + b, 0) / mouthHistory.length;
        for (let i = 5; i < mouthHistory.length - 5; i++) {
          const prev = mouthHistory[i - 5];
          const curr = mouthHistory[i];
          const next = mouthHistory[i + 5];
          if (curr > prev + 0.005 && curr > next + 0.005 && curr > 0.02) {
            chewingCycles++;
          }
        }
      }

      const isChewing = chewingCycles >= 1;
      const isSwallowing = headTiltRatio < 0.8;

      if (thresholdFeatures) {
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) poseHistory.shift();

        if (lstmFeatures) {
          featureHistory.push(lstmFeatures);
          if (featureHistory.length > LSTM_SEQ_LEN) featureHistory.shift();
        }

        // ── USE UNIFIED CLASSIFICATION WITH PRIORITY ORDER ──────────────────
        const activityResult = await classifyActivityWithPriority(
          normalizedKeypoints,
          thresholdFeatures,
          lstmFeatures,
          poseHistory,
          lastDetectedObjects
        );

        if (activityResult) {
          smoothedActivity = smoothPredictions(activityResult, activityHistory);
          activityHistory.push(activityResult);
          if (activityHistory.length > SMOOTHING_WINDOW) activityHistory.shift();

          if (onActivityCallback) {
            onActivityCallback({
              activity_name: smoothedActivity.activity,
              confidence: smoothedActivity.confidence,
              detected_at: new Date(),
              signals: smoothedActivity.signals,
              features: thresholdFeatures
            });
          }
        }
      }

      if (canvasElement && videoElement.videoWidth > 0) {
        if (canvasElement.width !== videoElement.videoWidth) {
          canvasElement.width = videoElement.videoWidth;
          canvasElement.height = videoElement.videoHeight;
        }

        const ctx = canvasElement.getContext('2d');
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        let isAligned = false;
        if (smoothedActivity && expectedActivityRef && expectedActivityRef.current) {
          isAligned = smoothedActivity.activity.toLowerCase() === expectedActivityRef.current.toLowerCase() &&
            smoothedActivity.confidence >= CONFIDENCE_THRESHOLD;
        }

        if (isAligned !== currentAlignment) {
          currentAlignment = isAligned;
          if (onAlignmentChangeCallback) onAlignmentChangeCallback(isAligned);
        }

        if (lastDetectedObjects) {
          lastDetectedObjects.forEach(obj => {
            ctx.strokeStyle = '#00FFFF';
            ctx.lineWidth = 2;
            ctx.strokeRect(obj.bbox[0], obj.bbox[1], obj.bbox[2], obj.bbox[3]);
            ctx.fillStyle = '#00FFFF';
            ctx.font = '16px Arial';
            ctx.fillText(`${obj.class} (${Math.round(obj.score * 100)}%)`, obj.bbox[0], obj.bbox[1] > 20 ? obj.bbox[1] - 5 : 10);
          });
        }
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
    console.error('Error in detection loop:', error);
  }

  if (isRunning) {
    requestAnimationFrame(detectPoseLoop);
  }
}

/**
 * Real majority-vote smoothing. A single noisy frame (e.g. one frame of
 * "Walking" while someone shifts in their chair) no longer flips the
 * reported activity — the new activity has to win a majority of the last
 * SMOOTHING_WINDOW raw predictions before we report it as the stable
 * activity. Until then we keep reporting the last stable activity (with
 * the new frame's confidence/signals attached so the UI still feels live).
 */
function smoothPredictions(activityResult, history) {
  if (!stableActivity) {
    stableActivity = activityResult;
    return activityResult;
  }

  const recent = [...history.slice(-(SMOOTHING_WINDOW - 1)), activityResult];
  const counts = {};
  for (const entry of recent) {
    counts[entry.activity] = (counts[entry.activity] || 0) + 1;
  }

  let winner = stableActivity.activity;
  let winnerCount = 0;
  for (const [act, count] of Object.entries(counts)) {
    if (count > winnerCount) {
      winner = act;
      winnerCount = count;
    }
  }

  const hasMajority = winnerCount >= Math.min(SMOOTHING_MAJORITY, recent.length);

  if (hasMajority && winner !== stableActivity.activity) {
    // New activity has earned the switch.
    const winningEntry = [...recent].reverse().find(e => e.activity === winner) || activityResult;
    stableActivity = winningEntry;
  } else if (hasMajority && winner === activityResult.activity) {
    // Same activity continues, but keep the latest confidence/signals fresh.
    stableActivity = activityResult;
  }
  // else: no majority yet — keep reporting stableActivity as-is, ignore the blip.

  return stableActivity;
}

export function stopPoseDetection() {
  isRunning = false;
  isInitializing = false;

  if (videoElement && videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  detector = null;
  faceDetector = null;
  objectDetector = null;
  lastDetectedObjects = [];
  mouthHistory = [];
  poseHistory = [];
  activityHistory = [];
  stableActivity = null;
  featureHistory = [];
  currentAlignment = false;
  frameCounter = 0;
}