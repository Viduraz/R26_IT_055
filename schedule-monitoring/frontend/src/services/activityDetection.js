// schedule-monitoring/frontend/src/services/activityDetection.js
/**
 * Activity Detection Service
 *
 * Primary path:
 *  1. LSTM model loaded from <BASE_URL>mediapipe_activity_model/tfjs/model.json.
 *
 * Fallback path:
 *  2. Threshold classifier based on BlazePose landmark geometry.
 *
 * This version uses the 33-landmark BlazePose schema so it matches the
 * MediaPipe CSV pipeline used for training.
 */

import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const USE_LSTM = true;
const CONFIDENCE_THRESHOLD = 0.50;
const ANKLE_CONFIDENCE_THRESHOLD = 0.35;
const HISTORY_SIZE = 12;
const LSTM_SEQ_LEN = 30;

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

let poseHistory = [];
let activityHistory = [];
let featureHistory = [];

// Tracks consecutive frames where the wrist stays above mouth level.
// Long sustained raise → drinking; short repeated bursts → eating.
let wristSustainFrames = 0;

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
// Tighter window (5 s) reduces bleed between cup and food memories
const OBJECT_MEMORY_DURATION = 5000;

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
  const torsoDX = Math.abs(hipMidX - shoulderMidX);
  const torsoDY = Math.abs(hipMidY - shoulderMidY);
  const torsoHeight = torsoDY;
  const torsoAlignment = torsoDX / (torsoDY + 0.001);
  features.push(torsoHeight);

  const leftLegAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightLegAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  features.push(leftLegAngle, rightLegAngle);

  const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
  features.push(leftArmAngle, rightArmAngle);

  const bodyHeight = Math.abs(Math.max(leftAnkle.y, rightAnkle.y) - nose.y);
  features.push(bodyHeight);

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  features.push(shoulderWidth);

  // Use actual mouth-corner landmarks (9 = left mouth, 10 = right mouth)
  // instead of the nose, so the wrist must reach true mouth level to trigger.
  const mouthLandmarkL = keypoints[9];
  const mouthLandmarkR = keypoints[10];
  const mLx = mouthLandmarkL?.x ?? nose.x;
  const mLy = mouthLandmarkL?.y ?? nose.y;
  const mRx = mouthLandmarkR?.x ?? nose.x;
  const mRy = mouthLandmarkR?.y ?? nose.y;
  const mouthX = (mLx + mRx) / 2;
  const mouthY = (mLy + mRy) / 2;
  const minHandToMouth = Math.min(
    euclideanDistance(leftWrist, { x: mouthX, y: mouthY }),
    euclideanDistance(rightWrist, { x: mouthX, y: mouthY })
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
  console.log('✓ LSTM-HAR model loaded');
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
    torsoAlignment
  ] = features;

  const latestPose = poseSequence && poseSequence[poseSequence.length - 1];
  const lowerBodyVisible = latestPose && [23, 24, 25, 26, 27, 28].filter(i => latestPose[i] && latestPose[i].score > 0.35).length >= 4;
  const leftAnkleConfident = latestPose && latestPose[27] && latestPose[27].score > ANKLE_CONFIDENCE_THRESHOLD;
  const rightAnkleConfident = latestPose && latestPose[28] && latestPose[28].score > ANKLE_CONFIDENCE_THRESHOLD;
  const anklesConfident = leftAnkleConfident && rightAnkleConfident;
  const now = Date.now();

  const hasCup = objects && objects.some(obj => ['cup', 'bottle', 'wine glass'].includes(obj.class));
  const hasFoodOrBowl = objects && objects.some(obj => [
    'bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
    'apple', 'banana', 'orange', 'plate', 'dining table', 'food'
  ].includes(obj.class));

  const hasBed = objects && objects.some(obj => obj.class === 'bed');
  if (hasBed) actionMemory.lastBedSeen = now;
  const sawBedRecently = (now - actionMemory.lastBedSeen) < 20000;

  const shoulderMidPt = latestPose && latestPose[11] && latestPose[12]
    ? { x: (latestPose[11].x + latestPose[12].x) / 2, y: (latestPose[11].y + latestPose[12].y) / 2 } : null;
  const hipMidPt = latestPose && latestPose[23] && latestPose[24]
    ? { x: (latestPose[23].x + latestPose[24].x) / 2, y: (latestPose[23].y + latestPose[24].y) / 2 } : null;
  const kneeMidPt = latestPose && latestPose[25] && latestPose[26]
    ? { x: (latestPose[25].x + latestPose[26].x) / 2, y: (latestPose[25].y + latestPose[26].y) / 2 } : null;
  const hipAngle = (shoulderMidPt && hipMidPt && kneeMidPt)
    ? calculateAngle(shoulderMidPt, hipMidPt, kneeMidPt) : null;
  const bodyIsStraight = hipAngle !== null && hipAngle >= 160;

  if (hasCup) {
    actionMemory.lastCupSeen = now;
    // Cross-clear: seeing a cup actively resets food memory so they don't both fire
    if (hasCup && !hasFoodOrBowl) actionMemory.lastFoodSeen = Math.min(actionMemory.lastFoodSeen, now - 4000);
  }
  if (hasFoodOrBowl) {
    actionMemory.lastFoodSeen = now;
    // Cross-clear: seeing food actively resets cup memory
    if (hasFoodOrBowl && !hasCup) actionMemory.lastCupSeen = Math.min(actionMemory.lastCupSeen, now - 4000);
  }
  if (handToMouth < 0.35 && hasCup) actionMemory.lastCupToMouth = now;
  if (handToMouth < 0.35 && !hasCup) actionMemory.lastEmptyHandToMouth = now;

  const sawCupRecently = (now - actionMemory.lastCupSeen) < 5000;
  const sawFoodRecently = (now - actionMemory.lastFoodSeen) < 5000;
  const didDrinkGestureRecently = (now - actionMemory.lastCupToMouth) < 5000;
  const didPillGestureRecently = (now - actionMemory.lastEmptyHandToMouth) < 12000;
  const objectMemory = getObjectMemoryStatus();

  let activity = null;
  let confidence = 0;
  let signals = { source: 'threshold' };

  if (
    (torsoAlignment > 1.1 && velocity < 0.04) ||
    (lowerBodyVisible && hipHeight > 0.45 && bodyHeight < 0.60 && velocity < 0.02) ||
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
  } else if (handToMouth < 0.35 &&
    (hasFoodOrBowl || sawFoodRecently || objectMemory.hasFood ||
      hasCup || sawCupRecently || objectMemory.hasCup)) {
    // Route through the dedicated disambiguator instead of a simple if/else
    const disambig = disambiguateEatingDrinking({
      hasCup, hasFoodOrBowl, sawCupRecently, sawFoodRecently,
      objectMemory, handToMouth, wristOscillation, headTiltRatio: arguments[7] ?? 1.0,
      chewingCycles: arguments[8] ?? 0, isChewing: arguments[6] ?? false,
    });
    activity = disambig.activity;
    confidence = disambig.confidence;
    signals = disambig.signals;
  } else if ((leftLegAngle > 150 && rightLegAngle > 150) && velocity < 0.05 && bodyHeight > 0.55) {
    activity = 'Walking';
    confidence = 0.70;
    signals = { velocity: velocity.toFixed(3), legAsymmetry: legAsymmetry.toFixed(1) };
  } else if ((leftLegAngle < 140 || rightLegAngle < 140) && velocity < 0.04) {
    activity = 'Sitting / rest';
    confidence = anklesConfident ? 0.86 : 0.78;
    signals = { posture: 'seated', legAsymmetry: legAsymmetry.toFixed(1), anklesConfident };
  } else if (leftLegAngle > 155 && rightLegAngle > 155 && velocity < 0.04) {
    activity = 'Standing';
    confidence = 0.82;
    signals = { posture: 'upright', velocity: velocity.toFixed(3) };
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

/**
 * disambiguateEatingDrinking
 * ──────────────────────────
 * Multi-signal biomechanical scorer that reliably distinguishes Eating from
 * Drinking when the primary `handToMouth < 0.35` trigger fires.
 *
 * Each physical cue votes for one activity; the winner is whichever
 * accumulates more points. The function is called by both the threshold
 * classifier (inside classifyActivity) AND as a post-LSTM override step in
 * the detection loop, so it always gets the final say on Eating vs Drinking.
 *
 * Signal scoring table
 * ─────────────────────────────────────────────────────────────────────────
 * Signal                          Eating  Drinking
 * ──────────────────────────────  ──────  ────────
 * Food object visible               +3      -1
 * Cup object visible                -1      +3
 * Food seen recently (5 s)          +1       0     (only if no cup)
 * Cup seen recently  (5 s)           0      +1     (only if no food)
 * Chewing cycles > 0                +2       0     ← jaw moves for eating
 * headTiltRatio < 0.85               0      +2     ← head tips back for glass
 * wristOscillation > 0.025          +2      -1     ← staccato scoop = eating
 * wristSustainFrames > 15           -1      +2     ← sustained raise = drinking
 * ─────────────────────────────────────────────────────────────────────────
 */
function disambiguateEatingDrinking({
  hasCup, hasFoodOrBowl, sawCupRecently, sawFoodRecently,
  objectMemory, handToMouth, wristOscillation, headTiltRatio, chewingCycles,
}) {
  let eatScore = 0;
  let drinkScore = 0;

  // 1 — Object evidence (strongest signal)
  if (hasFoodOrBowl) { eatScore += 3; drinkScore -= 1; }
  if (hasCup) { drinkScore += 3; eatScore -= 1; }
  if (sawFoodRecently && !hasCup) eatScore += 1;
  if (sawCupRecently && !hasFoodOrBowl) drinkScore += 1;
  if (objectMemory?.hasFood && !hasCup) eatScore += 1;
  if (objectMemory?.hasCup && !hasFoodOrBowl) drinkScore += 1;

  // 2 — Jaw / chewing signal
  if (chewingCycles > 0) eatScore += 2;

  // 3 — Head tilt (drinking tips head back → lower headTiltRatio)
  if (headTiltRatio < 0.85) drinkScore += 2;
  else if (headTiltRatio >= 1.0) eatScore += 1;  // neutral/level head → eating

  // 4 — Wrist oscillation (repetitive scooping = eating; smooth hold = drinking)
  if (wristOscillation > 0.025) { eatScore += 2; drinkScore -= 1; }
  else if (wristOscillation < 0.010) drinkScore += 1;

  // 5 — Sustained wrist raise (drinking holds arm up for several frames)
  if (wristSustainFrames > 15) { drinkScore += 2; eatScore -= 1; }
  else if (wristSustainFrames < 5) eatScore += 1;

  // Floor scores at 0
  eatScore = Math.max(0, eatScore);
  drinkScore = Math.max(0, drinkScore);

  const totalScore = eatScore + drinkScore || 1;  // avoid /0
  const winner = drinkScore > eatScore ? 'Drinking' : 'Eating';

  // Confidence: proportion of winning score, boosted if object evidence present
  const rawConf = Math.max(eatScore, drinkScore) / totalScore;  // 0.5 – 1.0
  const objBoost = (hasCup || hasFoodOrBowl) ? 0.08 : 0;
  const confidence = Math.min(0.97, 0.70 + rawConf * 0.22 + objBoost);

  return {
    activity: winner,
    confidence,
    signals: {
      source: 'disambig',
      eatScore, drinkScore, winner,
      handToMouth: typeof handToMouth === 'number' ? handToMouth.toFixed(3) : '?',
      wristOscillation: typeof wristOscillation === 'number' ? wristOscillation.toFixed(4) : '?',
      wristSustainFrames,
      headTiltRatio: typeof headTiltRatio === 'number' ? headTiltRatio.toFixed(2) : '?',
      chewingCycles,
      hasCup, hasFoodOrBowl,
    },
  };
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
    detectPoseLoop();
    return { detector };
  } catch (error) {
    isInitializing = false;
    console.error('Failed to initialize pose detection:', error);
    throw error;
  }
}

// ── IP Camera Support ─────────────────────────────────────────────────────

export function getIPCameraStreamUrl() {
  // The schedule-monitoring backend (port 8004 by default) proxies the RTSP
  // stream as MJPEG so the browser can consume it without a native RTSP client.
  const backendBase = import.meta.env.VITE_SCHEDULE_BACKEND_URL || 'http://localhost:8004';
  return `${backendBase}/api/monitoring/camera/stream`;
}

// Hidden canvas + Image used to render MJPEG frames so BlazePose can read them.
let ipCamImg = null;
let ipCamCanvas = null;
let ipCamCtx = null;
let ipCamAnimFrame = null;

function _startIPCamFramePump(video, onReady) {
  // Create an off-screen canvas the same size as the dest canvas (or 640×480).
  ipCamCanvas = document.createElement('canvas');
  ipCamCanvas.width = 640;
  ipCamCanvas.height = 480;
  ipCamCtx = ipCamCanvas.getContext('2d');

  ipCamImg = new Image();
  ipCamImg.crossOrigin = 'anonymous';

  let firstFrame = true;
  ipCamImg.onload = () => {
    if (firstFrame) {
      firstFrame = false;
      // Size canvas to actual frame
      ipCamCanvas.width = ipCamImg.naturalWidth || 640;
      ipCamCanvas.height = ipCamImg.naturalHeight || 480;
      // Tell the caller the video-like element is ready
      if (onReady) onReady();
    }
  };

  ipCamImg.src = getIPCameraStreamUrl();

  // Pump: draw MJPEG img into our off-screen canvas every rAF tick.
  // The `detector.estimatePoses` call below will be given `ipCamCanvas` as
  // the "video" element; BlazePose accepts HTMLCanvasElement as well.
  function pump() {
    if (!isRunning) return;
    if (ipCamImg && ipCamCtx && ipCamImg.naturalWidth > 0) {
      ipCamCtx.drawImage(ipCamImg, 0, 0, ipCamCanvas.width, ipCamCanvas.height);
    }
    ipCamAnimFrame = requestAnimationFrame(pump);
  }
  pump();
}

function _stopIPCamFramePump() {
  if (ipCamAnimFrame) cancelAnimationFrame(ipCamAnimFrame);
  ipCamAnimFrame = null;
  if (ipCamImg) { ipCamImg.src = ''; ipCamImg = null; }
  ipCamCanvas = null;
  ipCamCtx = null;
}

/**
 * Like `initializePoseDetection` but uses the IP camera MJPEG stream
 * instead of getUserMedia. The `video` element is used only for display
 * (we draw the MJPEG frames into it via a canvas→drawImage trick).
 */
export async function initializePoseDetectionWithIPCamera(video, canvas, expectedRef, onActivityDetected, onAlignmentChange) {
  if (isInitializing || isRunning) {
    console.warn('Pose detection already initializing or running — skipping duplicate call');
    return;
  }
  isInitializing = true;

  try {
    // Stop any existing webcam streams
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    videoElement = video;
    canvasElement = canvas;
    expectedActivityRef = expectedRef;
    onActivityCallback = onActivityDetected;
    onAlignmentChangeCallback = onAlignmentChange;

    await tf.setBackend('webgl');
    await tf.ready();

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
    console.log('✓ BlazePose loaded (IP cam mode)');

    const faceModel = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    faceDetector = await faceLandmarksDetection.createDetector(faceModel, {
      runtime: 'tfjs', refineLandmarks: false,
    });
    objectDetector = await cocoSsd.load();

    if (USE_LSTM) {
      loadLSTMModel().catch(err =>
        console.warn('LSTM model not found — using threshold classifier:', err.message)
      );
    }

    // Start the MJPEG frame pump and wait for the first frame before looping.
    await new Promise(resolve => {
      _startIPCamFramePump(video, resolve);
      // Safety timeout: start anyway after 3 s if onReady never fires
      setTimeout(resolve, 3000);
    });

    isRunning = true;
    isInitializing = false;

    // Run the shared detection loop — but override videoElement to point to
    // our off-screen canvas so BlazePose sees real pixel data.
    videoElement = ipCamCanvas;  // BlazePose accepts HTMLCanvasElement
    detectIPCamLoop(video, canvas);

    return { detector };
  } catch (error) {
    isInitializing = false;
    _stopIPCamFramePump();
    throw error;
  }
}

async function detectIPCamLoop(displayVideo, displayCanvas) {
  if (!isRunning || !detector || !ipCamCanvas) return;

  try {
    let objects = lastDetectedObjects;
    let faces = [];
    let poses = [];

    try {
      if (!isRunning || !detector) return;
      poses = await detector.estimatePoses(ipCamCanvas);

      if (!isRunning || !faceDetector) return;
      faces = await faceDetector.estimateFaces(ipCamCanvas);

      if (!isRunning) return;
      if (objectDetector && (Math.random() < 0.5 || lastDetectedObjects.length === 0)) {
        objects = await objectDetector.detect(ipCamCanvas);
        if (!isRunning) return;
        lastDetectedObjects = objects;
        updateObjectMemory(objects, Date.now());
      }
    } catch (e) { console.error(e); }

    if (!isRunning || !ipCamCanvas) return;

    // Mirror MJPEG frames to the visible <video> element via the display canvas
    if (displayCanvas) {
      if (displayCanvas.width !== ipCamCanvas.width) {
        displayCanvas.width = ipCamCanvas.width;
        displayCanvas.height = ipCamCanvas.height;
      }
      const dCtx = displayCanvas.getContext('2d');
      dCtx.drawImage(ipCamCanvas, 0, 0);
    }

    if (poses && poses.length > 0) {
      const pose = poses[0];
      const width = ipCamCanvas.width || 640;
      const height = ipCamCanvas.height || 480;
      const normalizedKeypoints = pose.keypoints.map(p => ({
        ...p, x: p.x / width, y: p.y / height,
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
          const prev = mouthHistory[i - 5], curr = mouthHistory[i], next = mouthHistory[i + 5];
          if (curr > prev + 0.005 && curr > next + 0.005 && curr > 0.02) chewingCycles++;
        }
      }
      const isChewing = chewingCycles >= 1;
      const isSwallowing = headTiltRatio < 0.8;

      // ── Wrist sustain tracker (IP cam) ───────────────────────────────────
      if (thresholdFeatures) {
        const wristMinY = thresholdFeatures[11] ?? 1.0;
        const wristRaised = wristMinY < 0.45;
        wristSustainFrames = wristRaised ? wristSustainFrames + 1 : Math.max(0, wristSustainFrames - 2);
      }

      if (thresholdFeatures) {
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) poseHistory.shift();

        if (lstmFeatures) {
          featureHistory.push(lstmFeatures);
          if (featureHistory.length > LSTM_SEQ_LEN) featureHistory.shift();
        }

        let activityResult = (lstmReady && featureHistory.length >= LSTM_SEQ_LEN)
          ? classifyWithLSTM(featureHistory) : null;

        const objectResult = classifyActivity(
          thresholdFeatures, poseHistory, 0,
          lastDetectedObjects, isChewing, isSwallowing, headTiltRatio, chewingCycles
        );

        if (objectResult && ['Eating', 'Drinking'].includes(objectResult.activity) && objectResult.confidence >= 0.80) {
          activityResult = objectResult;
        } else if (!activityResult) {
          activityResult = objectResult;
        }

        // Post-LSTM eating/drinking disambiguation (same as webcam loop)
        if (activityResult && ['Eating', 'Drinking'].includes(activityResult.activity)) {
          const hasCup = lastDetectedObjects.some(o => ['cup', 'bottle', 'wine glass'].includes(o.class));
          const hasFoodOrBowl = lastDetectedObjects.some(o =>
            ['bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
              'apple', 'banana', 'orange', 'plate', 'dining table', 'food'].includes(o.class));
          const now_ts = Date.now();
          const sawCupR = (now_ts - actionMemory.lastCupSeen) < 5000;
          const sawFoodR = (now_ts - actionMemory.lastFoodSeen) < 5000;
          const om = getObjectMemoryStatus();
          activityResult = disambiguateEatingDrinking({
            hasCup, hasFoodOrBowl, sawCupRecently: sawCupR, sawFoodRecently: sawFoodR,
            objectMemory: om,
            handToMouth: thresholdFeatures[7] ?? 0.5,
            wristOscillation: thresholdFeatures[13] ?? 0,
            headTiltRatio, chewingCycles,
          });
        }

        if (activityResult) {
          smoothedActivity = smoothPredictions(activityResult, activityHistory);
          activityHistory.push(smoothedActivity);
          if (activityHistory.length > 10) activityHistory.shift();

          if (onActivityCallback) {
            onActivityCallback({
              activity_name: smoothedActivity.activity,
              confidence: smoothedActivity.confidence,
              detected_at: new Date(),
              signals: smoothedActivity.signals,
              features: thresholdFeatures,
            });
          }
        }
      }

      // Draw COCO-SSD boxes on display canvas
      if (displayCanvas && displayCanvas.width > 0) {
        const dCtx = displayCanvas.getContext('2d');
        if (lastDetectedObjects) {
          lastDetectedObjects.forEach(obj => {
            dCtx.strokeStyle = '#00FFFF';
            dCtx.lineWidth = 2;
            dCtx.strokeRect(obj.bbox[0], obj.bbox[1], obj.bbox[2], obj.bbox[3]);
            dCtx.fillStyle = '#00FFFF';
            dCtx.font = '14px Arial';
            dCtx.fillText(`${obj.class} (${Math.round(obj.score * 100)}%)`, obj.bbox[0], obj.bbox[1] > 20 ? obj.bbox[1] - 5 : 10);
          });
        }

        let isAligned = false;
        if (smoothedActivity && expectedActivityRef && expectedActivityRef.current) {
          isAligned = smoothedActivity.activity.toLowerCase() === expectedActivityRef.current.toLowerCase()
            && smoothedActivity.confidence >= CONFIDENCE_THRESHOLD;
        }
        if (isAligned !== currentAlignment) {
          currentAlignment = isAligned;
          if (onAlignmentChangeCallback) onAlignmentChangeCallback(isAligned);
        }
      }
    }
  } catch (error) {
    console.error('Error in IP cam detection loop:', error);
  }

  if (isRunning) requestAnimationFrame(() => detectIPCamLoop(displayVideo, displayCanvas));
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
      if (objectDetector && (Math.random() < 0.5 || lastDetectedObjects.length === 0)) {
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

      // ── Wrist sustain tracker ────────────────────────────────────────────
      // Count consecutive frames where EITHER wrist is above mouth level.
      // Normalized coords: smaller y = higher on screen.
      if (thresholdFeatures) {
        const wristMinY = thresholdFeatures[11] ?? 1.0;   // min wrist Y (feature index 11)
        // Mouth Y ≈ nose Y (landmark 0), normalised — we proxy via handToMouth feature.
        // A wristMinY < 0.45 means the wrist is in the upper half of the frame, consistent
        // with a raised drinking arm.
        const wristRaised = wristMinY < 0.45;
        wristSustainFrames = wristRaised ? wristSustainFrames + 1 : Math.max(0, wristSustainFrames - 2);
      }

      if (thresholdFeatures) {
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) poseHistory.shift();

        if (lstmFeatures) {
          featureHistory.push(lstmFeatures);
          if (featureHistory.length > LSTM_SEQ_LEN) featureHistory.shift();
        }

        // Step 1 — Base classification: LSTM (pose-only) if ready, otherwise threshold.
        let activityResult = (lstmReady && featureHistory.length >= LSTM_SEQ_LEN)
          ? classifyWithLSTM(featureHistory)
          : null;

        // Step 2 — Threshold classifier (always runs for object + biomechanical context)
        const objectResult = classifyActivity(
          thresholdFeatures, poseHistory, 0,
          lastDetectedObjects, isChewing, isSwallowing, headTiltRatio, chewingCycles
        );

        if (
          objectResult &&
          ['Eating', 'Drinking'].includes(objectResult.activity) &&
          objectResult.confidence >= 0.80
        ) {
          // Strong object+biomech evidence — override whatever the LSTM said.
          activityResult = objectResult;
        } else if (!activityResult) {
          // LSTM not ready yet — fall back to threshold.
          activityResult = objectResult;
        }

        // Step 3 — Post-LSTM eating/drinking disambiguation.
        // Even if LSTM picked one, rerun the biomechanical scorer to correct it.
        // Only fires when the result is Eating or Drinking (avoids touching other classes).
        if (activityResult && ['Eating', 'Drinking'].includes(activityResult.activity)) {
          const hasCup = lastDetectedObjects.some(o => ['cup', 'bottle', 'wine glass'].includes(o.class));
          const hasFoodOrBowl = lastDetectedObjects.some(o =>
            ['bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
              'apple', 'banana', 'orange', 'plate', 'dining table', 'food'].includes(o.class));
          const now_ts = Date.now();
          const sawCupR = (now_ts - actionMemory.lastCupSeen) < 5000;
          const sawFoodR = (now_ts - actionMemory.lastFoodSeen) < 5000;
          const om = getObjectMemoryStatus();
          const hand2mouth = thresholdFeatures[7] ?? 0.5;
          const wristOsc = thresholdFeatures[13] ?? 0;

          activityResult = disambiguateEatingDrinking({
            hasCup, hasFoodOrBowl, sawCupRecently: sawCupR, sawFoodRecently: sawFoodR,
            objectMemory: om, handToMouth: hand2mouth, wristOscillation: wristOsc,
            headTiltRatio, chewingCycles,
          });
        }

        if (activityResult) {
          smoothedActivity = smoothPredictions(activityResult, activityHistory);
          activityHistory.push(smoothedActivity);
          if (activityHistory.length > 10) activityHistory.shift();

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

function smoothPredictions(activityResult, history) {
  if (!history.length) return activityResult;
  const recent = history.slice(-5);
  const same = recent.filter(e => e.activity === activityResult.activity);

  // Current frame has 3+ matching frames in recent history — trust it.
  if (same.length >= 3) return activityResult;

  // Not enough support — return the most frequent label from recent history
  // instead of emitting a potentially flickery one-frame spike.
  const freq = {};
  for (const e of recent) freq[e.activity] = (freq[e.activity] || 0) + 1;
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    const dominantActivity = sorted[0][0];
    const dominantEntry = [...recent].reverse().find(e => e.activity === dominantActivity);
    if (dominantEntry) return dominantEntry;
  }
  return activityResult;
}

export function stopPoseDetection() {
  isRunning = false;
  isInitializing = false;

  // Stop webcam stream if active
  if (videoElement && videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  // Stop IP cam frame pump if active
  _stopIPCamFramePump();

  detector = null;
  faceDetector = null;
  objectDetector = null;
  lastDetectedObjects = [];
  mouthHistory = [];
  poseHistory = [];
  activityHistory = [];
  featureHistory = [];
  currentAlignment = false;
  wristSustainFrames = 0;
}
