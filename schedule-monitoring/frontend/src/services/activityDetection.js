// schedule-monitoring/frontend/src/services/activityDetection.js

import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const HISTORY_SIZE = 12;
const SMOOTHING_WINDOW = 5;
const SMOOTHING_MAJORITY = 3;
const ASYNC_DETECT_EVERY_N_FRAMES = 3;

// WALKING THRESHOLDS (Optimized for demo video playback)
const WALKING_VELOCITY_THRESHOLD = 0.012;
const WALKING_LEG_ASYMMETRY_MIN = 2.5;

// SLEEPING THRESHOLDS (Strict Horizontal ~180° Orientation)
const SLEEPING_MAX_VELOCITY = 0.05;
const SLEEPING_HOLD_MS = 1500; // Decreased hold time for quick demo video response

const DRINKING_GESTURE_DURATION = 2000;

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

let poseHistory = [];
let activityHistory = [];
let stableActivity = null;

let handMotionHistory = [];
let lastEatingCycleTime = 0;
let drinkingGestureActive = false;
let lastDrinkingGestureTime = 0;
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
  const keypointsToTrack = [0, 15, 16, 23, 24, 27, 28];
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

  if (!nose || !leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) || 0.2;
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;

  // HORIZONTAL SPINE ANGLE (0° or 180° = Perfectly Horizontal)
  const dy = hipMidY - shoulderMidY;
  const dx = hipMidX - shoulderMidX;
  const spineAngleDegrees = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));

  const leftLegAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightLegAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);

  const bodyHeight = Math.abs(hipMidY - nose.y) * 1.6;

  const leftWristDist = euclideanDistance(leftWrist, nose);
  const rightWristDist = euclideanDistance(rightWrist, nose);
  const minHandDistance = Math.min(leftWristDist, rightWristDist);
  const normalizedHandToMouth = (minHandDistance / shoulderWidth);

  const velocity = calculateMovementVelocity(keypoints);
  const legAsymmetry = Math.abs(leftLegAngle - rightLegAngle);
  const wristOscillation = calculateWristOscillation(keypoints);

  return [
    spineAngleDegrees, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, normalizedHandToMouth, velocity, legAsymmetry,
    wristOscillation
  ];
}

function updateObjectMemory(detectedObjects, currentTime) {
  if (!detectedObjects || detectedObjects.length === 0) return;

  const foodClasses = ['bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza',
    'donut', 'cake', 'apple', 'banana', 'orange', 'plate', 'dining table', 'food', 'cup'];
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

function detectSleepingPosture(spineAngleDegrees, velocity) {
  const isHorizontal = spineAngleDegrees <= 25.0 || spineAngleDegrees >= 155.0;
  const isBodyStill = velocity < SLEEPING_MAX_VELOCITY;

  if (!isHorizontal || !isBodyStill) {
    sleepingCandidateSince = 0;
    return null;
  }

  const now = Date.now();
  if (!sleepingCandidateSince) sleepingCandidateSince = now;
  if (now - sleepingCandidateSince < SLEEPING_HOLD_MS) return null;

  return {
    activity: 'Sleeping',
    confidence: 0.92,
    signals: { rule: 'horizontal_body_180_deg', spine_angle: spineAngleDegrees.toFixed(1) }
  };
}

function detectWalkingPattern(velocity, legAsymmetry, wristOscillation, leftLegAngle, rightLegAngle) {
  const isMoving = velocity >= WALKING_VELOCITY_THRESHOLD;
  const hasLegOrArmMotion = legAsymmetry >= WALKING_LEG_ASYMMETRY_MIN || wristOscillation >= 0.005;
  const legsExtended = leftLegAngle > 120 && rightLegAngle > 120;

  if (isMoving && hasLegOrArmMotion && legsExtended) {
    return {
      isWalking: true,
      confidence: velocity > WALKING_VELOCITY_THRESHOLD * 2 ? 0.88 : 0.75,
      signals: { rule: 'walking_gait_motion', velocity: velocity.toFixed(4) }
    };
  }

  return { isWalking: false };
}

function detectEatingPattern(normHandToMouth, velocity, objects, isChewing = false) {
  const objectMem = getObjectMemoryStatus();
  const hasFoodOrBowl = (objects && objects.some(obj => [
    'bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
    'apple', 'banana', 'orange', 'plate', 'dining table', 'food', 'cup'
  ].includes(obj.class))) || objectMem.hasFood;

  const now = Date.now();
  const isHandNearMouth = normHandToMouth < 1.1; 
  const isMovingSlowly = velocity < 0.08;

  if (isHandNearMouth) {
    handMotionHistory.push({ timestamp: now, isNear: true });
  }

  if (handMotionHistory.length > 20) handMotionHistory.shift();

  const recentNearCount = handMotionHistory.filter(h => now - h.timestamp < 3000).length;
  const isGestureActive = recentNearCount >= 2;

  if (isGestureActive) {
    lastEatingCycleTime = now;
  }

  const isEating = (isGestureActive || isChewing || (now - lastEatingCycleTime < 2500)) && isMovingSlowly;
  const confidenceBoost = hasFoodOrBowl ? 0.18 : 0.05;

  return {
    isEating,
    confidenceBoost,
    signals: { normHandToMouth: normHandToMouth.toFixed(2), is_chewing: isChewing, food_detected: hasFoodOrBowl }
  };
}

function detectDrinkingPattern(normHandToMouth, velocity, objects) {
  const objectMem = getObjectMemoryStatus();
  const hasCup = (objects && objects.some(obj =>
    ['cup', 'bottle', 'wine glass', 'glass'].includes(obj.class)
  )) || objectMem.hasCup;

  const now = Date.now();
  const isHandNearMouth = normHandToMouth < 1.1;
  const isMovingSlowly = velocity < 0.08;

  if (!drinkingGestureActive && isHandNearMouth && isMovingSlowly) {
    drinkingGestureActive = true;
    return { isDrinking: true, signals: { status: 'in_progress', cup: hasCup } };
  }

  if (drinkingGestureActive && isHandNearMouth) {
    return { isDrinking: true, signals: { status: 'holding', cup: hasCup } };
  }

  if (drinkingGestureActive && !isHandNearMouth) {
    drinkingGestureActive = false;
    lastDrinkingGestureTime = now;
    return { isDrinking: true, signals: { status: 'releasing', cup: hasCup } };
  }

  if (now - lastDrinkingGestureTime < DRINKING_GESTURE_DURATION) {
    return { isDrinking: true, signals: { status: 'cooldown', cup: hasCup } };
  }

  return { isDrinking: false, signals: { status: 'idle', cup: hasCup } };
}

function classifyActivity(features, poseSequence, objects = [], isChewing = false) {
  if (!features || features.length < 11) return null;

  const [
    spineAngleDegrees, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, normHandToMouth, velocity, legAsymmetry,
    wristOscillation
  ] = features;

  // PRIORITY 1: SLEEPING
  const sleepingResult = detectSleepingPosture(spineAngleDegrees, velocity);
  if (sleepingResult) return sleepingResult;

  // PRIORITY 2: WALKING
  const walkingResult = detectWalkingPattern(velocity, legAsymmetry, wristOscillation, leftLegAngle, rightLegAngle);
  if (walkingResult.isWalking) {
    return {
      activity: 'Walking',
      confidence: walkingResult.confidence,
      signals: walkingResult.signals
    };
  }

  // PRIORITY 3: EATING
  const eatingPattern = detectEatingPattern(normHandToMouth, velocity, objects, isChewing);
  if (eatingPattern.isEating) {
    return {
      activity: 'Eating',
      confidence: Math.min(0.78 + eatingPattern.confidenceBoost, 0.95),
      signals: { rule: 'eating_pattern', details: eatingPattern.signals }
    };
  }

  // PRIORITY 4: DRINKING
  const drinkingPattern = detectDrinkingPattern(normHandToMouth, velocity, objects);
  if (drinkingPattern.isDrinking && drinkingPattern.signals.status !== 'idle') {
    return {
      activity: 'Drinking',
      confidence: drinkingPattern.signals.cup ? 0.90 : 0.80,
      signals: { rule: 'drinking_pattern', details: drinkingPattern.signals }
    };
  }

  // PRIORITY 5: SITTING / REST
  const isSittingPosture = (leftLegAngle < 145 || rightLegAngle < 145) && velocity < 0.08;
  const hasChair = objects && objects.some(obj => obj.class === 'chair');

  if (isSittingPosture) {
    return {
      activity: 'Sitting / rest',
      confidence: hasChair ? 0.91 : 0.82,
      signals: {
        rule: hasChair ? 'sitting_posture_with_chair_priority_override' : 'sitting_posture_priority_override',
        leg_angle_left: leftLegAngle.toFixed(1),
        leg_angle_right: rightLegAngle.toFixed(1),
      }
    };
  }

  // PRIORITY 6: DEFAULT FALLBACK
  return {
    activity: 'Sitting / rest',
    confidence: 0.55,
    signals: { rule: 'default_fallback_sitting' }
  };
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

// IP Camera stream helper function
export function getIPCameraStreamUrl(ipAddress, port = '8080', streamPath = '/video') {
  if (!ipAddress) return '';
  const cleanIp = ipAddress.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `http://${cleanIp}:${port}${streamPath}`;
}

// IP Camera detection initialization helper
export async function initializePoseDetectionWithIPCamera(video, streamUrl, onActivityDetected) {
  if (isInitializing || isRunning) return { detector };
  isInitializing = true;

  try {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }

    videoElement = video;
    onActivityCallback = onActivityDetected;
    videoElement.src = streamUrl;
    videoElement.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      videoElement.onloadeddata = () => resolve();
      videoElement.onerror = (e) => reject(e);
    });

    await video.play();

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

    isRunning = true;
    isInitializing = false;
    frameCounter = 0;
    detectPoseLoop();
    return { detector };
  } catch (error) {
    isInitializing = false;
    console.error('Failed to initialize IP camera pose detection:', error);
    throw error;
  }
}

async function detectPoseLoop() {
  if (!isRunning || !detector || !videoElement) return;

  try {
    frameCounter++;
    const poses = await detector.estimatePoses(videoElement);

    let objects = lastDetectedObjects;
    let faces = [];

    if (frameCounter % ASYNC_DETECT_EVERY_N_FRAMES === 0) {
      if (faceDetector) {
        faces = await faceDetector.estimateFaces(videoElement).catch(() => []);
      }
      if (objectDetector) {
        objects = await objectDetector.detect(videoElement).catch(() => []);
        lastDetectedObjects = objects;
        updateObjectMemory(objects, Date.now());
      }
    }

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
        let diffs = 0;
        for (let i = 1; i < mouthHistory.length; i++) {
          diffs += Math.abs(mouthHistory[i] - mouthHistory[i - 1]);
        }
        isChewing = (diffs / mouthHistory.length) > 0.004;
      }

      if (thresholdFeatures) {
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) poseHistory.shift();

        const activityResult = classifyActivity(thresholdFeatures, poseHistory, lastDetectedObjects, isChewing);

        if (activityResult) {
          const smoothedActivity = smoothPredictions(activityResult, activityHistory);
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
    }
  } catch (error) {
    console.error('Error in detection loop:', error);
  }

  if (isRunning) {
    requestAnimationFrame(detectPoseLoop);
  }
}

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
}