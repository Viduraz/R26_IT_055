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

const USE_LSTM = true;
const CONFIDENCE_THRESHOLD = 0.50;       // used for alignment / UI feedback
const LSTM_CONFIDENCE_THRESHOLD = 0.55;  // below this, fall back to threshold classifier
const ANKLE_CONFIDENCE_THRESHOLD = 0.35;
const HISTORY_SIZE = 12;
const LSTM_SEQ_LEN = 30;
const SMOOTHING_WINDOW = 5;
const SMOOTHING_MAJORITY = 3; // out of SMOOTHING_WINDOW, need this many agreeing to switch
const OBJECT_DETECT_EVERY_N_FRAMES = 2;
const WALKING_MIN_VELOCITY = 0.018; // must show actual movement to count as walking
const WALKING_MIN_LEG_ASYMMETRY = 6; // degrees; walking gait alternates leg angles

// Built from Vite's BASE_URL so this never goes stale if the base path
// (currently "/schedule/") ever changes. import.meta.env.BASE_URL already
// includes the trailing slash.
const LSTM_MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe_activity_model/tfjs/model.json`;
const LSTM_STATS_PATH = `${import.meta.env.BASE_URL}mediapipe_activity_model/tfjs/norm_stats.json`;

let LSTM_ACTIVITY_NAMES = [];

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
  if (normalized === 'sleep' || normalized === 'sleeping') return 'Sleeping';
  if (normalized === 'sitting') return 'Sitting / rest';
  if (normalized === 'standing') return 'Standing';
  if (normalized === 'walking') return 'Walking';
  if (normalized === 'drinking') return 'Drinking';
  if (normalized === 'eating') return 'Eating';
  if (normalized === 'taking_medications') return 'Taking Medications';
  if (normalized === 'movement') return 'Movement';
  return activity;
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
  LSTM_ACTIVITY_NAMES = Array.isArray(stats.class_names) && stats.class_names.length > 0
    ? stats.class_names
    : ['eating', 'drinking', 'sitting', 'sleeping', 'walking'];
  normMean = new Float32Array(stats.mean);
  normStd = new Float32Array(stats.std);
  lstmModel = await tf.loadLayersModel(LSTM_MODEL_PATH);
  const dummy = tf.zeros([1, LSTM_SEQ_LEN, normMean.length]);
  lstmModel.predict(dummy).dispose();
  dummy.dispose();
  lstmReady = true;
  console.log('✓ LSTM-HAR model loaded. Trained classes:', LSTM_ACTIVITY_NAMES);
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
  const activity = normalizeActivityLabel(LSTM_ACTIVITY_NAMES[maxIdx] || 'Movement');
  const confidence = probs[maxIdx];
  const signals = {
    source: 'lstm',
    probs: Object.fromEntries(
      LSTM_ACTIVITY_NAMES.map((name, i) => [name, +probs[i].toFixed(3)])
    )
  };
  return { activity, confidence, signals };
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
  let signals = { source: 'threshold' };

  if (
    (torsoAlignment > 1.1 && velocity < 0.04) ||
    (hipHeight > 0.45 && bodyHeight < 0.60 && velocity < 0.02) ||
    (torsoAlignment > 0.9 && bodyIsStraight && sawBedRecently && velocity < 0.05)
  ) {
    activity = 'Sleeping';
    confidence = (sawBedRecently && bodyIsStraight) ? 0.94 : (torsoAlignment > 1.3 ? 0.90 : 0.82);
    signals = {
      posture: 'lying',
      movement: 'minimal',
      torsoAlignment: torsoAlignment.toFixed(2),
      hipAngle: hipAngle !== null ? hipAngle.toFixed(1) : null,
      bodyIsStraight,
      bedInScene: sawBedRecently,
    };
  } else if (handToMouth < 0.35 && (hasFoodOrBowl || sawFoodRecently || objectMemory.hasFood)) {
    activity = 'Eating';
    confidence = hasFoodOrBowl ? 0.95 : 0.82;
    signals = {
      handToMouth: handToMouth.toFixed(3),
      foodVisible: hasFoodOrBowl,
      recentFood: sawFoodRecently,
      source: 'threshold',
    };
  } else if (handToMouth < 0.35 && (hasCup || sawCupRecently || objectMemory.hasCup)) {
    activity = 'Drinking';
    confidence = hasCup ? 0.95 : 0.80;
    signals = {
      handToMouth: handToMouth.toFixed(3),
      cupVisible: hasCup,
      recentCup: sawCupRecently,
      source: 'threshold',
    };
  } else if (
    legsStraight && bodyHeight > 0.55 &&
    velocity >= WALKING_MIN_VELOCITY &&
    legAsymmetry >= WALKING_MIN_LEG_ASYMMETRY
  ) {
    // Walking now REQUIRES actual movement + alternating leg angles.
    // Straight legs + near-zero velocity used to fall in here by mistake —
    // that case now belongs to Standing below.
    activity = 'Walking';
    confidence = anklesConfident ? 0.80 : 0.62;
    signals = { velocity: velocity.toFixed(3), legAsymmetry: legAsymmetry.toFixed(1), anklesConfident };
  } else if (legsStraight && velocity < WALKING_MIN_VELOCITY) {
    activity = 'Standing';
    confidence = anklesConfident ? 0.85 : 0.68;
    signals = { posture: 'upright', velocity: velocity.toFixed(3), anklesConfident };
  } else if ((leftLegAngle < 140 || rightLegAngle < 140) && velocity < 0.04) {
    activity = 'Sitting / rest';
    confidence = anklesConfident ? 0.86 : 0.78;
    signals = { posture: 'seated', legAsymmetry: legAsymmetry.toFixed(1), anklesConfident };
  } else if (didPillGestureRecently && didDrinkGestureRecently && isSwallowing && velocity < 0.08) {
    activity = 'Taking Medications';
    confidence = 0.88;
    signals = { source: 'threshold', gesture: 'pill' };
  } else {
    activity = 'Movement';
    confidence = 0.55;
    signals = { source: 'threshold', velocity: velocity.toFixed(3) };
  }

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

        let activityResult = null;
        if (lstmReady && featureHistory.length >= LSTM_SEQ_LEN) {
          const lstmResult = classifyWithLSTM(featureHistory);
          if (lstmResult && lstmResult.confidence >= LSTM_CONFIDENCE_THRESHOLD) {
            activityResult = lstmResult;
          } else {
            // LSTM is unsure this frame — fall back to the geometry-based
            // classifier instead of trusting a low-confidence guess.
            activityResult = classifyActivity(thresholdFeatures, poseHistory, 0, lastDetectedObjects, isChewing, isSwallowing, headTiltRatio, chewingCycles);
            if (activityResult) {
              activityResult.signals = { ...activityResult.signals, lstmLowConfidence: lstmResult ? lstmResult.confidence : null };
            }
          }
        } else {
          activityResult = classifyActivity(thresholdFeatures, poseHistory, 0, lastDetectedObjects, isChewing, isSwallowing, headTiltRatio, chewingCycles);
        }

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