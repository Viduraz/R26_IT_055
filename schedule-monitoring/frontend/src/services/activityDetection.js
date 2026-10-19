// schedule-monitoring/frontend/src/services/activityDetection.js

import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const USE_RF = true;
const RF_CONFIDENCE_THRESHOLD = 0.55;
const ANKLE_CONFIDENCE_THRESHOLD = 0.35;
const HISTORY_SIZE = 12;
const SMOOTHING_WINDOW = 5;
const SMOOTHING_MAJORITY = 3;
const ASYNC_DETECT_EVERY_N_FRAMES = 3;

const WALKING_VELOCITY_THRESHOLD = 0.018;
const WALKING_LEG_ASYMMETRY_MIN = 8;
const WALKING_UPRIGHT_MIN_HEIGHT = 0.45;

const SLEEPING_MIN_TORSO_ALIGNMENT = 1.0;
const SLEEPING_MIN_TORSO_ALIGNMENT_WITH_BED = 0.7;
const SLEEPING_MAX_VELOCITY = 0.04;
const SLEEPING_HOLD_MS = 2500;

const OBJECT_CONFIDENCE_THRESHOLD = 0.5;
const EATING_GESTURE_WINDOW_MS = 10000;

const RF_API_ENDPOINT = `/api/monitoring/predict-rf`;

let detector = null;
let faceDetector = null;
let objectDetector = null;
let lastDetectedObjects = [];
let mouthHistory = [];
let isRunning = false;
let isInitializing = false;
let videoElement = null;
let onActivityCallback = null;
let frameCounter = 0;
let lastUnknownEmittedAt = 0;
let ipCameraImage = null;
let detectionCanvas = null;

const IP_CAMERA_STREAM_URL = "/api/monitoring/camera/stream";

export function getIPCameraStreamUrl() {
  return IP_CAMERA_STREAM_URL;
}

let poseHistory = [];
let activityHistory = [];
let stableActivity = null;

let handMotionHistory = [];
let handNearMouthState = false;
let handNearMouthSince = 0;
let sleepingCandidateSince = 0;

const actionMemory = {
  lastCupSeen: 0,
  lastFoodSeen: 0,
  lastBedSeen: 0,
};

const OBJECT_MEMORY_DURATION = 12000;

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
  return Math.sqrt(Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2));
}

function calculateMovementVelocity(currentKeypoints) {
  if (poseHistory.length < 2) return 0;
  const prevKeypoints = poseHistory[poseHistory.length - 1];
  let totalMovement = 0;
  let count = 0;
  const keypointsToTrack = [0, 15, 16, 27, 28];
  for (const idx of keypointsToTrack) {
    if (currentKeypoints[idx] && prevKeypoints[idx] &&
      currentKeypoints[idx].score > 0.2 && prevKeypoints[idx].score > 0.2) {
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
        currentKeypoints[idx].score > 0.2 && prev[idx].score > 0.2) {
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

  const requiredPoints = [
    nose, leftShoulder, rightShoulder, leftHip, rightHip,
    leftKnee, rightKnee, leftAnkle, rightAnkle,
  ];
  if (requiredPoints.some((point) => !point || (point.score ?? 1) < 0.3)) return null;
  if ([leftAnkle, rightAnkle].some((point) => (point.score ?? 1) < ANKLE_CONFIDENCE_THRESHOLD)) {
    return null;
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) || 0.2;
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

  const leftLegAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightLegAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);

  const bodyHeight = Math.abs(hipMidY - nose.y) * 1.6;

  // DYNAMIC NORMALIZED HAND-TO-FACE DISTANCE
  const leftWristDist = euclideanDistance(leftWrist, nose);
  const rightWristDist = euclideanDistance(rightWrist, nose);
  const leftElbowDist = euclideanDistance(leftElbow, nose);
  const rightElbowDist = euclideanDistance(rightElbow, nose);

  const minHandDistance = Math.min(leftWristDist, rightWristDist);
  const minElbowDistance = Math.min(leftElbowDist, rightElbowDist);

  // Normalize relative to shoulder width
  const normalizedHandToMouth = (minHandDistance / shoulderWidth);
  const normalizedElbowToMouth = (minElbowDistance / shoulderWidth);

  const velocity = calculateMovementVelocity(keypoints);
  const legAsymmetry = Math.abs(leftLegAngle - rightLegAngle);
  const hipHeight = (leftHip.y + rightHip.y) / 2;
  const wristHeight = Math.min(leftWrist.y, rightWrist.y);
  const elbowAboveShoulder = (leftShoulder.y + rightShoulder.y) / 2 - Math.min(leftElbow.y, rightElbow.y);
  const wristOscillation = calculateWristOscillation(keypoints);

  return [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, normalizedHandToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment, 1, normalizedElbowToMouth
  ];
}

function updateObjectMemory(detectedObjects, currentTime) {
  if (!detectedObjects) return;

  const foodClasses = ['bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza',
    'donut', 'cake', 'apple', 'banana', 'orange', 'plate'];
  const cupClasses = ['cup', 'bottle', 'wine glass', 'glass'];

  for (const obj of detectedObjects) {
    if (foodClasses.includes(obj.class)) actionMemory.lastFoodSeen = currentTime;
    if (cupClasses.includes(obj.class)) actionMemory.lastCupSeen = currentTime;
    if (obj.class === 'bed') actionMemory.lastBedSeen = currentTime;
  }
}

function getObjectMemoryStatus() {
  const now = Date.now();
  return {
    hasFood: (now - actionMemory.lastFoodSeen) < OBJECT_MEMORY_DURATION,
    hasCup: (now - actionMemory.lastCupSeen) < OBJECT_MEMORY_DURATION,
  };
}

function detectSleepingPosture(features, objects = []) {
  if (!features || features.length < 15) return null;

  const velocity = Number(features[8]) || 0;
  const torsoAlignment = Number(features[14]) || 0;
  const bedDetected = objects.some(obj => obj.class === 'bed') || (Date.now() - actionMemory.lastBedSeen < 15000);
  const chairDetected = objects.some(obj => obj.class === 'chair');

  const minTorso = bedDetected
    ? SLEEPING_MIN_TORSO_ALIGNMENT_WITH_BED
    : SLEEPING_MIN_TORSO_ALIGNMENT;

  const candidate =
    torsoAlignment > minTorso &&
    velocity < SLEEPING_MAX_VELOCITY &&
    !(chairDetected && torsoAlignment < SLEEPING_MIN_TORSO_ALIGNMENT);

  if (!candidate) {
    sleepingCandidateSince = 0;
    return null;
  }

  const now = Date.now();
  if (!sleepingCandidateSince) sleepingCandidateSince = now;
  if (now - sleepingCandidateSince < SLEEPING_HOLD_MS) return null;

  return {
    activity: 'Sleeping',
    confidence: bedDetected ? 0.90 : 0.84,
    signals: { rule: 'sleeping_horizontal_torso' }
  };
}

function detectEatingPattern(normHandToMouth, normElbowToMouth, velocity, objects, isChewing = false) {
  const objectMem = getObjectMemoryStatus();
  const hasMealObject = (objects && objects.some(obj => [
    'bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
    'apple', 'banana', 'orange', 'plate'
  ].includes(obj.class))) || objectMem.hasFood;

  const now = Date.now();
  // Elbow proximity alone is too weak: it caused ordinary gestures and poses
  // to be labeled as eating. Track actual wrist approaches as transitions,
  // not as one positive sample per video frame.
  const isHandNearMouth = normHandToMouth < 1.35 && normElbowToMouth < 2.0;
  const isMovingSlowly = velocity < 0.12;

  if (isHandNearMouth !== handNearMouthState) {
    handMotionHistory.push({ timestamp: now, isNear: isHandNearMouth });
    handNearMouthState = isHandNearMouth;
    handNearMouthSince = isHandNearMouth ? now : 0;
  }

  handMotionHistory = handMotionHistory.filter(
    (event) => now - event.timestamp < EATING_GESTURE_WINDOW_MS
  );
  const recentApproaches = handMotionHistory.filter((event) => event.isNear).length;
  const repeatedHandToMouthGesture = isHandNearMouth && recentApproaches >= 3;
  const mealObjectGesture = hasMealObject && isHandNearMouth;
  const chewingGesture = isChewing && isMovingSlowly &&
    (hasMealObject || repeatedHandToMouthGesture);
  const isEating = isMovingSlowly && (
    mealObjectGesture || repeatedHandToMouthGesture || chewingGesture
  );
  const confidence = hasMealObject ? 0.88 : isChewing ? 0.78 : 0.68;

  return {
    isEating,
    confidence,
    signals: {
      normHandToMouth: normHandToMouth.toFixed(2),
      is_chewing: isChewing,
      meal_object_detected: hasMealObject,
      repeated_hand_gesture: repeatedHandToMouthGesture,
    }
  };
}

function detectDrinkingPattern(normHandToMouth, normElbowToMouth, velocity, objects) {
  const objectMem = getObjectMemoryStatus();
  const hasCup = (objects && objects.some(obj =>
    ['cup', 'bottle', 'wine glass', 'glass'].includes(obj.class)
  )) || objectMem.hasCup;

  const isHandNearMouth = normHandToMouth < 1.3 && normElbowToMouth < 2.0;
  const isMovingSlowly = velocity < 0.12;
  const handHeldAtMouth = handNearMouthSince > 0 && Date.now() - handNearMouthSince >= 700;

  return {
    isDrinking: hasCup && isHandNearMouth && handHeldAtMouth && isMovingSlowly,
    signals: {
      cup: hasCup,
      hand_near_mouth: isHandNearMouth,
      hand_held_at_mouth: handHeldAtMouth,
      moving_slowly: isMovingSlowly,
    },
  };
}

function classifyActivity(features, poseSequence, objects = [], isChewing = false) {
  if (!features || features.length < 15) return null;

  const [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, normHandToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment, anklesConfidentFlag, normElbowToMouth
  ] = features;

  if (!features.slice(0, 15).every(Number.isFinite)) {
    return { activity: 'Unknown', confidence: 0, signals: { rule: 'invalid_pose_features' } };
  }

  // 1. SLEEPING GATE
  const sleepingResult = detectSleepingPosture(features, objects);
  if (sleepingResult) return sleepingResult;

  // 2. EATING PATTERN
  const eatingPattern = detectEatingPattern(normHandToMouth, normElbowToMouth, velocity, objects, isChewing);
  if (eatingPattern.isEating) {
    return {
      activity: 'Eating',
      confidence: eatingPattern.confidence,
      signals: { rule: 'eating_pattern', details: eatingPattern.signals }
    };
  }

  // 3. DRINKING PATTERN
  const drinkingPattern = detectDrinkingPattern(normHandToMouth, normElbowToMouth, velocity, objects);
  if (drinkingPattern.isDrinking) {
    return {
      activity: 'Drinking',
      confidence: 0.88,
      signals: { rule: 'drinking_pattern', details: drinkingPattern.signals }
    };
  }

  // 4. WALKING PATTERN
  const isMoving = velocity >= WALKING_VELOCITY_THRESHOLD;
  const isUpright = bodyHeight > WALKING_UPRIGHT_MIN_HEIGHT && leftLegAngle > 135 && rightLegAngle > 135;
  const hasLegMotion = legAsymmetry >= WALKING_LEG_ASYMMETRY_MIN || wristOscillation >= 0.006;

  if (isMoving && isUpright && hasLegMotion) {
    return {
      activity: 'Walking',
      confidence: velocity > WALKING_VELOCITY_THRESHOLD * 2 ? 0.85 : 0.72,
      signals: { rule: 'walking_gait', velocity: velocity.toFixed(4) }
    };
  }

  // 5. Sitting or resting requires a stable, bent-leg posture.
  const hasChair = objects.some((object) => object.class === 'chair');
  const isSittingPosture =
    velocity < 0.055 &&
    torsoAlignment < 0.8 &&
    ((leftLegAngle < 125 && rightLegAngle < 125) ||
      (hasChair && (leftLegAngle < 150 || rightLegAngle < 150)));

  if (isSittingPosture) {
    return {
      activity: 'Sitting / rest',
      confidence: hasChair ? 0.91 : 0.82,
      signals: {
        rule: hasChair ? 'sitting_posture_with_chair' : 'sitting_posture',
        sitting_posture: true,
        chair_detected: hasChair,
        leg_angle_left: leftLegAngle.toFixed(1),
        leg_angle_right: rightLegAngle.toFixed(1),
      }
    };
  }

  return { activity: 'Unknown', confidence: 0, signals: { rule: 'no_supported_activity' } };
}

async function initializeModels() {
  await tf.setBackend('webgl');
  await tf.ready();

  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.BlazePose,
    {
      runtime: 'mediapipe',
      modelType: 'full',
      enableSmoothing: true,
      solutionPath: `${import.meta.env.BASE_URL}mediapipe_pose`,
    }
  );

  const faceModel = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  faceDetector = await faceLandmarksDetection.createDetector(faceModel, { runtime: 'tfjs', refineLandmarks: false });
  objectDetector = await cocoSsd.load();
}

function resetDetectionHistory() {
  frameCounter = 0;
  lastUnknownEmittedAt = 0;
  lastDetectedObjects = [];
  mouthHistory = [];
  poseHistory = [];
  activityHistory = [];
  stableActivity = null;
  handMotionHistory = [];
  handNearMouthState = false;
  handNearMouthSince = 0;
  sleepingCandidateSince = 0;
  actionMemory.lastCupSeen = 0;
  actionMemory.lastFoodSeen = 0;
  actionMemory.lastBedSeen = 0;
}

export async function initializePoseDetection(video, canvas, expectedRef, onActivityDetected, onAlignmentChange) {
  if (isInitializing || isRunning) return { detector };
  isInitializing = true;

  try {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }

    videoElement = video;
    onActivityCallback = onActivityDetected;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();

    ipCameraImage?.removeAttribute('src');
    ipCameraImage = null;
    detectionCanvas = canvas;
    resetDetectionHistory();
    await initializeModels();

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

export async function initializePoseDetectionWithIPCamera(video, canvas, expectedRef, onActivityDetected, onAlignmentChange) {
  if (isInitializing || isRunning) return { detector };
  isInitializing = true;

  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    videoElement = video;
    ipCameraImage = image;
    detectionCanvas = canvas;
    onActivityCallback = onActivityDetected;

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Timed out waiting for the IP camera stream.')), 15000);
      image.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not load the IP camera stream. Check the camera and backend.'));
      };
      image.src = getIPCameraStreamUrl();
    });

    resetDetectionHistory();
    await initializeModels();

    isRunning = true;
    isInitializing = false;
    detectPoseLoop();
    return { detector };
  } catch (error) {
    isInitializing = false;
    ipCameraImage?.removeAttribute('src');
    ipCameraImage = null;
    console.error('Failed to initialize IP camera pose detection:', error);
    throw error;
  }
}

async function detectPoseLoop() {
  const input = ipCameraImage || videoElement;
  if (!isRunning || !detector || !input) return;

  try {
    if (ipCameraImage && detectionCanvas) {
      const context = detectionCanvas.getContext('2d');
      if (context) {
        detectionCanvas.width = ipCameraImage.naturalWidth || 640;
        detectionCanvas.height = ipCameraImage.naturalHeight || 480;
        context.drawImage(ipCameraImage, 0, 0, detectionCanvas.width, detectionCanvas.height);
      }
    }
    frameCounter++;
    const poses = await detector.estimatePoses(input);

    let objects = lastDetectedObjects;
    let faces = [];

    // Run heavier models asynchronously every N frames to avoid blocking pose execution
    if (frameCounter % ASYNC_DETECT_EVERY_N_FRAMES === 0) {
      if (faceDetector) {
        faces = await faceDetector.estimateFaces(input).catch(() => []);
      }
      if (objectDetector) {
        const detections = await objectDetector.detect(input).catch(() => []);
        objects = detections.filter(
          (object) => object.score >= OBJECT_CONFIDENCE_THRESHOLD
        );
        lastDetectedObjects = objects;
        updateObjectMemory(objects, Date.now());
      }
    }

    if (poses && poses.length > 0) {
      const pose = poses[0];
      const width = input.videoWidth || input.naturalWidth || 640;
      const height = input.videoHeight || input.naturalHeight || 480;
      const normalizedKeypoints = pose.keypoints.map(p => ({
        ...p,
        x: p.x / width,
        y: p.y / height
      }));

      const thresholdFeatures = extractThresholdFeatures(normalizedKeypoints);
      let isChewing = false;

      if (faces && faces.length > 0 && faces[0].keypoints) {
        const faceKp = faces[0].keypoints;
        if (faceKp[13] && faceKp[14] && faceKp[10] && faceKp[152]) {
          const lipDist = Math.sqrt(Math.pow(faceKp[13].x - faceKp[14].x, 2) + Math.pow(faceKp[13].y - faceKp[14].y, 2));
          const faceHeight = Math.sqrt(Math.pow(faceKp[10].x - faceKp[152].x, 2) + Math.pow(faceKp[10].y - faceKp[152].y, 2));
          mouthHistory.push(lipDist / (faceHeight || 1));
          if (mouthHistory.length > 20) mouthHistory.shift();
        }
      }

      if (mouthHistory.length > 8) {
        const recentMouth = mouthHistory.slice(-12);
        let totalVariation = 0;
        for (let i = 1; i < recentMouth.length; i++) {
          totalVariation += Math.abs(recentMouth[i] - recentMouth[i - 1]);
        }
        const mouthRange = Math.max(...recentMouth) - Math.min(...recentMouth);
        isChewing =
          recentMouth.length >= 10 &&
          mouthRange > 0.035 &&
          totalVariation / (recentMouth.length - 1) > 0.006;
      }

      if (thresholdFeatures) {
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) poseHistory.shift();

        const activityResult = classifyActivity(thresholdFeatures, poseHistory, lastDetectedObjects, isChewing);

        if (activityResult) {
          const smoothedActivity = smoothPredictions(activityResult, activityHistory);
          if (smoothedActivity.activity === 'Unknown') {
            emitUnknownIfDue();
          } else {
            activityHistory.push(activityResult);
            if (activityHistory.length > SMOOTHING_WINDOW) activityHistory.shift();
            notifyActivity({
              activity_name: smoothedActivity.activity,
              confidence: smoothedActivity.confidence,
              detected_at: new Date(),
              signals: smoothedActivity.signals,
              features: thresholdFeatures
            });
          }
        }
      } else {
        poseHistory = [];
        handMotionHistory = [];
        handNearMouthState = false;
        handNearMouthSince = 0;
        sleepingCandidateSince = 0;
        emitUnknownIfDue();
      }
    } else {
      emitUnknownIfDue();
    }
  } catch (error) {
    console.error('Error in detection loop:', error);
  }

  if (isRunning) {
    requestAnimationFrame(detectPoseLoop);
  }
}

function notifyActivity(detection) {
  if (!onActivityCallback) return;
  try {
    const callbackResult = onActivityCallback(detection);
    if (callbackResult && typeof callbackResult.catch === 'function') {
      callbackResult.catch((error) => console.error('Activity callback failed:', error));
    }
  } catch (error) {
    console.error('Activity callback failed:', error);
  }
}

function emitUnknownIfDue() {
  const now = Date.now();
  if (now - lastUnknownEmittedAt < 1000) return;
  lastUnknownEmittedAt = now;
  activityHistory = [];
  stableActivity = { activity: 'Unknown', confidence: 0, signals: { rule: 'no_reliable_person_pose' } };
  poseHistory = [];
  handMotionHistory = [];
  handNearMouthState = false;
  handNearMouthSince = 0;
  sleepingCandidateSince = 0;
  notifyActivity({
    activity_name: 'Unknown',
    confidence: 0,
    detected_at: new Date(now),
    signals: { rule: 'no_reliable_person_pose' },
  });
}

function smoothPredictions(activityResult, history) {
  if (activityResult.activity === 'Unknown') {
    history.length = 0;
    stableActivity = activityResult;
    return activityResult;
  }

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
    const winningEntry = [...recent].reverse().find(e => e.activity === winner) || activityResult;
    stableActivity = winningEntry;
  } else if (hasMajority && winner === activityResult.activity) {
    stableActivity = activityResult;
  }

  return stableActivity;
}

export function stopPoseDetection() {
  isRunning = false;
  isInitializing = false;

  // Stop webcam stream if active
  if (videoElement && videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  if (ipCameraImage) {
    ipCameraImage.onload = null;
    ipCameraImage.onerror = null;
    ipCameraImage.removeAttribute('src');
    ipCameraImage = null;
  }
  detectionCanvas = null;

  detector = null;
  faceDetector = null;
  objectDetector = null;
  lastDetectedObjects = [];
  mouthHistory = [];
  poseHistory = [];
  activityHistory = [];
  stableActivity = null;
}
