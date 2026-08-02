// schedule-monitoring/frontend/src/services/activityDetection.js
/**
 * Activity Detection Service
 *
 * Two-tier classification strategy:
 *
 *  1. LSTM model (primary) — loaded from /lstm_har_model/model.json when available.
 *  2. Threshold classifier (fallback) — rule-based, always active when LSTM unavailable.
 *
 * v3: wrist elevation guard for eating (no more bowl-on-table false positives)
 * v4: fixed sitting/rest vs standing confusion (bent-knee RANGE, not just a lower
 *     bound), added explicit "Standing" posture, added posture hysteresis so
 *     losing sight of the legs doesn't default to "sitting".
 * v5: enhanced Sleeping detection — added an explicit hip-angle check for
 *     "body forms a straight line" (torso-to-thigh ~180°) combined with a
 *     COCO-SSD "bed" object-context signal. No pretrained lying-down/sleep
 *     classifier exists that beats hand-tuned pose geometry (confirmed via
 *     research — every public fall/lying-down detector uses this same
 *     keypoint-geometry approach), so this improves the heuristic directly.
 * v6: FIX — sitting-vs-standing was using the hip→knee→ankle leg angle even
 *     when the ankle keypoint was occluded (e.g. tucked under a blanket,
 *     out of frame). MoveNet still emits a low-confidence position guess for
 *     an occluded ankle, usually extrapolated in a near-straight line from
 *     the knee, which falsely inflated the leg angle into the "straight leg"
 *     / Standing range even while the person was clearly seated with bent
 *     knees. Fix: require BOTH ankle keypoints to individually clear a
 *     confidence threshold before trusting the leg-angle calculation. When
 *     ankles are unreliable, fall back to the hip angle (torso→hip→knee,
 *     already computed for Sleeping) — it only needs hips + knees, which
 *     remain visible, and it directly captures "is the torso folded over
 *     the legs" (sitting) vs "in line with the legs" (standing).
 */

import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// ── LSTM toggle ────────────────────────────────────────────────────────────────
const USE_LSTM = true;

// ── MoveNet state ──────────────────────────────────────────────────────────────
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

// ── Temporal history ───────────────────────────────────────────────────────────
const HISTORY_SIZE = 12;
let poseHistory = [];
let activityHistory = [];

const actionMemory = {
  lastCupSeen: 0,
  lastFoodSeen: 0,
  lastEmptyHandToMouth: 0,
  lastCupToMouth: 0,
  lastEatingGestureWithFood: 0,
  lastBedSeen: 0, // v5 — bed is stable furniture, given a long memory window
  // Object Memory
  detectedFoodObjects: [],
  detectedCups: [],
  detectedUtensils: [],
};

const OBJECT_MEMORY_MAX = 10;
const OBJECT_MEMORY_DURATION = 10000;

let featureHistory = [];

// ── Posture stability tracker (v4) ──────────────────────────────────────────────
// Tracks sitting/standing streaks and remembers the last full-body-confirmed
// posture so we have something sane to fall back to when legs leave the frame.
const postureState = {
  lastFullBodyPosture: null, // "Sitting / rest" | "Standing" | null
  sittingStreak: 0,
  standingStreak: 0,
  requiredStreak: 5, // consecutive qualifying frames needed before flipping state
};

// v6: minimum per-keypoint confidence required before an ankle position is
// trusted for leg-angle geometry. Below this, the ankle is treated as "not
// visible" even though MoveNet still returns *some* coordinate for it.
const ANKLE_CONFIDENCE_THRESHOLD = 0.35;

// ── LSTM model state ───────────────────────────────────────────────────────────
let lstmModel = null;
let normMean = null;
let normStd = null;
let lstmReady = false;

const LSTM_SEQ_LEN = 30;
const LSTM_MODEL_PATH = '/schedule/lstm_har_model/model.json';
const LSTM_STATS_PATH = '/schedule/lstm_har_model/norm_stats.json';

const LSTM_ACTIVITY_NAMES = [
  'Sleeping', 'Eating', 'Drinking', 'Taking Medications',
  'Walking', 'Sitting / rest', 'Standing', 'Movement'
];

const CONFIDENCE_THRESHOLD = 0.50;

function normalizeActivityLabel(activity) {
  if (!activity) return activity;

  const label = String(activity).trim();
  if (label === 'Sleep') return 'Sleeping';
  return label;
}

// ── Initialize ─────────────────────────────────────────────────────────────────
export async function initializePoseDetection(video, canvas, expectedRef, onActivityDetected, onAlignmentChange) {
  if (isInitializing || isRunning) {
    console.warn("Pose detection already initializing or running — skipping duplicate call");
    return { detector };
  }
  isInitializing = true;

  try {
    if (video.srcObject) {
      const oldTracks = video.srcObject.getTracks();
      oldTracks.forEach(track => track.stop());
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
    console.log("TensorFlow.js backend:", tf.getBackend());

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

    const faceModel = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    const faceDetectorConfig = { runtime: 'tfjs', refineLandmarks: false };
    faceDetector = await faceLandmarksDetection.createDetector(faceModel, faceDetectorConfig);
    console.log("✓ Face Landmarks detector loaded");

    objectDetector = await cocoSsd.load();
    console.log("✓ COCO-SSD object detector loaded");

    if (USE_LSTM) {
      loadLSTMModel().catch(err =>
        console.warn("LSTM model not found — using threshold classifier:", err.message)
      );
    }

    isRunning = true;
    isInitializing = false;
    detectPoseLoop();

    return { detector };
  } catch (error) {
    isInitializing = false;
    console.error("Failed to initialize pose detection:", error);
    throw error;
  }
}

// ── Main detection loop ────────────────────────────────────────────────────────
async function detectPoseLoop() {
  if (!isRunning || !detector || !videoElement) return;

  try {
    let objects = lastDetectedObjects;
    let faces = [];
    let poses = [];
    try {
      poses = await detector.estimatePoses(videoElement);
      faces = await faceDetector.estimateFaces(videoElement);
      // Run object detection on 50% of frames (catches food/bed reliably)
      if (Math.random() < 0.5 || lastDetectedObjects.length === 0) {
        objects = await objectDetector.detect(videoElement);
        lastDetectedObjects = objects;
        updateObjectMemory(objects, Date.now());
      }
    } catch (e) { console.error(e); }

    if (poses && poses.length > 0) {
      const pose = poses[0];

      const width = videoElement.videoWidth || 640;
      const height = videoElement.videoHeight || 480;
      const normalizedKeypoints = pose.keypoints.map(p => ({
        ...p,
        x: p.x / width,
        y: p.y / height
      }));

      const features = extractPoseFeatures(normalizedKeypoints);
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
      let mouthVariance = 0;
      if (mouthHistory.length > 10) {
        const mean = mouthHistory.reduce((a, b) => a + b, 0) / mouthHistory.length;
        mouthVariance = mouthHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / mouthHistory.length;

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

      if (features) {
        poseHistory.push(normalizedKeypoints);
        if (poseHistory.length > HISTORY_SIZE) {
          poseHistory.shift();
        }

        featureHistory.push(features);
        if (featureHistory.length > LSTM_SEQ_LEN) featureHistory.shift();

        const activityResult = (lstmReady && featureHistory.length >= LSTM_SEQ_LEN)
          ? classifyWithLSTM(featureHistory)
          : classifyActivity(features, poseHistory, mouthVariance, lastDetectedObjects, isChewing, isSwallowing, headTiltRatio, chewingCycles);

        if (activityResult) {
          smoothedActivity = smoothPredictions(activityResult, activityHistory);

          activityHistory.push(smoothedActivity);
          if (activityHistory.length > 10) {
            activityHistory.shift();
          }

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

        if (faces && faces.length > 0) {
          ctx.fillStyle = '#FF00FF';
          const faceKp = faces[0].keypoints;
          [13, 14, 78, 308].forEach(idx => {
            if (faceKp[idx]) {
              ctx.beginPath();
              ctx.arc(faceKp[idx].x, faceKp[idx].y, 3, 0, 2 * Math.PI);
              ctx.fill();
            }
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
    console.error("Error in detection loop:", error);
  }

  if (isRunning) {
    requestAnimationFrame(detectPoseLoop);
  }
}

// ── Feature Extraction ─────────────────────────────────────────────────────────
function extractPoseFeatures(keypoints) {
  if (!keypoints || keypoints.length < 17) return null;

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

  // 1. TORSO HEIGHT
  const shoulderMidX = (kp.leftShoulder.x + kp.rightShoulder.x) / 2;
  const shoulderMidY = (kp.leftShoulder.y + kp.rightShoulder.y) / 2;
  const hipMidX = (kp.leftHip.x + kp.rightHip.x) / 2;
  const hipMidY = (kp.leftHip.y + kp.rightHip.y) / 2;

  const torsoDX = Math.abs(hipMidX - shoulderMidX);
  const torsoDY = Math.abs(hipMidY - shoulderMidY);
  const torsoHeight = torsoDY;
  const torsoAlignment = torsoDX / (torsoDY + 0.001);

  features.push(torsoHeight);

  // 2. LEG ANGLES
  const leftLegAngle = calculateAngle(kp.leftHip, kp.leftKnee, kp.leftAnkle);
  const rightLegAngle = calculateAngle(kp.rightHip, kp.rightKnee, kp.rightAnkle);
  features.push(leftLegAngle, rightLegAngle);

  // 3. ARM ANGLES
  const leftArmAngle = calculateAngle(kp.leftShoulder, kp.leftElbow, kp.leftWrist);
  const rightArmAngle = calculateAngle(kp.rightShoulder, kp.rightElbow, kp.rightWrist);
  features.push(leftArmAngle, rightArmAngle);

  // 4. BODY HEIGHT
  const noseY = kp.nose.y;
  const ankleY = Math.max(kp.leftAnkle.y, kp.rightAnkle.y);
  const bodyHeight = Math.abs(ankleY - noseY);
  features.push(bodyHeight);

  // 5. BODY WIDTH
  const shoulderWidth = Math.abs(kp.leftShoulder.x - kp.rightShoulder.x);
  features.push(shoulderWidth);

  // 6. HAND-TO-MOUTH DISTANCE — simple Euclidean
  const noseX = kp.nose.x;
  const leftWristDist = euclideanDistance(kp.leftWrist, { x: noseX, y: noseY });
  const rightWristDist = euclideanDistance(kp.rightWrist, { x: noseX, y: noseY });
  const minHandToMouth = Math.min(leftWristDist, rightWristDist);
  features.push(minHandToMouth);

  // 7. MOVEMENT VELOCITY
  const velocity = calculateMovementVelocity(keypoints);
  features.push(velocity);

  // 8. LEG ASYMMETRY
  const legAsymmetry = Math.abs(leftLegAngle - rightLegAngle);
  features.push(legAsymmetry);

  // 9. HIP HEIGHT
  const hipHeight = (kp.leftHip.y + kp.rightHip.y) / 2;
  features.push(hipHeight);

  // 10. WRIST HEIGHT
  const leftWristY = (kp.leftWrist && kp.leftWrist.score > 0.3) ? kp.leftWrist.y : 1.0;
  const rightWristY = (kp.rightWrist && kp.rightWrist.score > 0.3) ? kp.rightWrist.y : 1.0;
  const maxWristHeight = Math.min(leftWristY, rightWristY);
  features.push(maxWristHeight);

  // 11. ELBOW ABOVE SHOULDER
  const shoulderAvgY = (kp.leftShoulder.y + kp.rightShoulder.y) / 2;
  const minElbowY = Math.min(kp.leftElbow.y, kp.rightElbow.y);
  const elbowAboveShoulder = shoulderAvgY - minElbowY;
  features.push(elbowAboveShoulder);

  // 12. WRIST OSCILLATION
  const wristOscillation = calculateWristOscillation(keypoints);
  features.push(wristOscillation);

  // 13. TORSO ALIGNMENT
  features.push(torsoAlignment);

  return features;
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

function calculateWristOscillation(currentKeypoints) {
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
}

// ── Object Memory ──────────────────────────────────────────────────────────────
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
    // NOTE: "bed" is intentionally NOT stored in the short-lived object memory
    // arrays above — it's handled separately via actionMemory.lastBedSeen with
    // a much longer window, since a bed doesn't appear/disappear like food does.
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

// ── LSTM ───────────────────────────────────────────────────────────────────────
async function loadLSTMModel() {
  console.log('Loading LSTM-HAR model …');
  const statsRes = await fetch(LSTM_STATS_PATH);
  if (!statsRes.ok) throw new Error(`norm_stats.json not found at ${LSTM_STATS_PATH}`);
  const stats = await statsRes.json();
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
  const activity = normalizeActivityLabel(LSTM_ACTIVITY_NAMES[maxIdx]);
  const confidence = probs[maxIdx];
  const signals = {
    source: 'lstm',
    probs: Object.fromEntries(
      LSTM_ACTIVITY_NAMES.map((name, i) => [name, +probs[i].toFixed(3)])
    )
  };
  return { activity, confidence, signals };
}

// ══════════════════════════════════════════════════════════════════════════════
// THRESHOLD CLASSIFIER — v6
// ══════════════════════════════════════════════════════════════════════════════
function classifyActivity(features, poseSequence, mouthVariance = 0, objects = [], isChewing = false, isSwallowing = false, headTiltRatio = 1.0, chewingCycles = 0) {
  if (!features || features.length < 12) return null;

  const [
    torsoHeight, leftLegAngle, rightLegAngle, leftArmAngle, rightArmAngle,
    bodyHeight, shoulderWidth, handToMouth, velocity, legAsymmetry,
    hipHeight, wristHeight, elbowAboveShoulder, wristOscillation,
    torsoAlignment
  ] = features;

  const latestPose = poseSequence && poseSequence[poseSequence.length - 1];
  const lowerBodyVisible = latestPose && (() => {
    const lowerIndices = [11, 12, 13, 14, 15, 16];
    const visible = lowerIndices.filter(i => latestPose[i] && latestPose[i].score > 0.35);
    return visible.length >= 4;
  })();

  // v6: ankles must be individually confident before the hip-knee-ankle leg
  // angle is trusted. A hidden/occluded ankle (blanket, out of frame, tucked
  // under the body) still gets a coordinate from MoveNet — usually a guess
  // extrapolated near-straight from the knee — which otherwise falsely
  // reads as a straight, standing leg.
  const leftAnkleConfident = latestPose && latestPose[15] && latestPose[15].score > ANKLE_CONFIDENCE_THRESHOLD;
  const rightAnkleConfident = latestPose && latestPose[16] && latestPose[16].score > ANKLE_CONFIDENCE_THRESHOLD;
  const anklesConfident = leftAnkleConfident && rightAnkleConfident;
  const now = Date.now();

  const hasCup = objects && objects.some(obj => ['cup', 'bottle', 'wine glass'].includes(obj.class));
  const hasFoodOrBowl = objects && objects.some(obj => [
    'bowl', 'spoon', 'fork', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake',
    'apple', 'banana', 'orange', 'plate', 'dining table', 'food'
  ].includes(obj.class));

  // v5: bed context for Sleeping
  const hasBed = objects && objects.some(obj => obj.class === 'bed');
  if (hasBed) actionMemory.lastBedSeen = now;
  const sawBedRecently = (now - actionMemory.lastBedSeen) < 20000; // beds are stationary — long memory

  // hip angle — "does the torso form a straight ~180° line with the thigh?"
  // (angle between torso and thigh at the hip: ~180° extended/straight,
  //  much less than that when folded, as in sitting)
  // v6: this is now ALSO used as the primary sitting/standing signal
  // whenever the ankle keypoints are unreliable, since it only depends on
  // shoulders/hips/knees — all of which stay visible even when the lower
  // legs are hidden under a blanket or out of frame.
  const shoulderMidPt = latestPose && latestPose[5] && latestPose[6]
    ? { x: (latestPose[5].x + latestPose[6].x) / 2, y: (latestPose[5].y + latestPose[6].y) / 2 } : null;
  const hipMidPt = latestPose && latestPose[11] && latestPose[12]
    ? { x: (latestPose[11].x + latestPose[12].x) / 2, y: (latestPose[11].y + latestPose[12].y) / 2 } : null;
  const kneeMidPt = latestPose && latestPose[13] && latestPose[14]
    ? { x: (latestPose[13].x + latestPose[14].x) / 2, y: (latestPose[13].y + latestPose[14].y) / 2 } : null;
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

  let activity = null;
  let confidence = 0;
  let signals = { source: 'threshold' };

  // ── SLEEPING (v5) ────────────────────────────────────────────────────────
  if (
    (torsoAlignment > 1.1 && velocity < 0.04) ||                                     // torso horizontal
    (lowerBodyVisible && hipHeight > 0.45 && bodyHeight < 0.60 && velocity < 0.02) || // low-movement fallback
    (torsoAlignment > 0.9 && bodyIsStraight && sawBedRecently && velocity < 0.05)     // straight body + bed in scene
  ) {
    activity = "Sleeping";
    confidence = (sawBedRecently && bodyIsStraight) ? 0.94 : (torsoAlignment > 1.3 ? 0.90 : 0.82);
    signals = {
      posture: "lying",
      movement: "minimal",
      torsoAlignment: torsoAlignment.toFixed(2),
      hipAngle: hipAngle !== null ? hipAngle.toFixed(1) : null,
      bodyIsStraight,
      bedInScene: sawBedRecently,
    };
  }

  // ── TAKING MEDICATIONS ─────────────────────────────────────────────────────
  else if (
    didPillGestureRecently &&
    didDrinkGestureRecently &&
    isSwallowing &&
    velocity < 0.08
  ) {
    activity = "Taking Medications";
    confidence = sawCupRecently ? 0.99 : 0.90;
    signals = {
      posture: "sitting_or_standing",
      interaction: "pill_then_water",
    };
  }

  // ── DRINKING ───────────────────────────────────────────────────────────────
  else if (
    handToMouth < 0.30 &&
    hasCup &&
    velocity < 0.08
  ) {
    activity = "Drinking";
    confidence = 0.96;
    signals = {
      posture: "sitting_or_standing",
      interaction: "hand_to_mouth_with_cup",
      handToMouth: handToMouth.toFixed(3),
      objectDetected: "cup/bottle",
    };
  }

  // ── EATING ─────────────────────────────────────────────────────────────────
  else if (
    handToMouth < 0.35 &&
    (hasFoodOrBowl || objectMemory.hasFood) &&
    velocity < 0.08
  ) {
    activity = "Eating";
    confidence = hasFoodOrBowl ? 0.95 : 0.88;
    signals = {
      posture: "sitting",
      interaction: "hand_to_mouth_with_food",
      handToMouth: handToMouth.toFixed(3),
      objectDetected: hasFoodOrBowl ? "food/plate" : "food_from_memory",
    };
    actionMemory.lastEatingGestureWithFood = now;
  }

  else if (
    handToMouth < 0.40 &&
    isChewing &&
    sawFoodRecently &&
    velocity < 0.08
  ) {
    activity = "Eating";
    confidence = 0.85;
    signals = {
      posture: "sitting",
      interaction: "eating_chewing_detected",
      handToMouth: handToMouth.toFixed(3),
      objectDetected: "food_temporal_memory",
      chewCycles: chewingCycles,
    };
    actionMemory.lastEatingGestureWithFood = now;
  }

  else if (
    handToMouth < 0.45 &&
    (now - actionMemory.lastEatingGestureWithFood) < 15000 &&
    velocity < 0.08
  ) {
    activity = "Eating";
    confidence = 0.78;
    signals = {
      posture: "sitting",
      interaction: "eating_ongoing_context",
      handToMouth: handToMouth.toFixed(3),
    };
  }

  // ── WALKING ────────────────────────────────────────────────────────────────
  else if (
    lowerBodyVisible &&
    anklesConfident &&           // v6: gait detection also depends on real ankle motion — don't let a guessed ankle fake it
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
      legAsymmetry: legAsymmetry.toFixed(1),
    };
    postureState.lastFullBodyPosture = "Standing";
  }

  // ── SITTING / REST / STANDING (v6 fix) ──────────────────────────────────────
  else if (
    velocity < 0.034 &&
    handToMouth > 0.40
  ) {
    // v6: only trust the ankle-based leg angle when both ankles are
    // confidently visible. Otherwise, derive posture from the hip angle
    // (torso→hip→knee), which stays reliable when legs/feet are occluded.
    const kneesBent = anklesConfident
      ? (
        lowerBodyVisible &&
        leftLegAngle >= 60 && leftLegAngle <= 150 &&
        rightLegAngle >= 60 && rightLegAngle <= 150 &&
        legAsymmetry < 35
      )
      : (hipAngle !== null && hipAngle < 150);

    const legsStraight = anklesConfident
      ? (
        lowerBodyVisible &&
        leftLegAngle > 150 &&
        rightLegAngle > 150
      )
      : (hipAngle !== null && hipAngle >= 160);

    if (kneesBent) {
      postureState.sittingStreak++;
      postureState.standingStreak = 0;
    } else if (legsStraight) {
      postureState.standingStreak++;
      postureState.sittingStreak = 0;
    }

    if (postureState.sittingStreak >= postureState.requiredStreak) {
      postureState.lastFullBodyPosture = "Sitting / rest";
    } else if (postureState.standingStreak >= postureState.requiredStreak) {
      postureState.lastFullBodyPosture = "Standing";
    }

    if (kneesBent) {
      activity = "Sitting / rest";
      confidence = postureState.lastFullBodyPosture === "Sitting / rest" ? 0.90 : 0.80;
      signals = {
        posture: "sitting",
        legAngleAvg: ((leftLegAngle + rightLegAngle) / 2).toFixed(1),
        hipAngle: hipAngle !== null ? hipAngle.toFixed(1) : null,
        kneesBent: true,
        method: anklesConfident ? "leg_angle" : "hip_angle_fallback_ankle_occluded",
      };
    } else if (legsStraight) {
      activity = "Standing";
      confidence = postureState.lastFullBodyPosture === "Standing" ? 0.85 : 0.75;
      signals = {
        posture: "standing",
        legAngleAvg: ((leftLegAngle + rightLegAngle) / 2).toFixed(1),
        hipAngle: hipAngle !== null ? hipAngle.toFixed(1) : null,
        method: anklesConfident ? "leg_angle" : "hip_angle_fallback_ankle_occluded",
      };
    } else if (!lowerBodyVisible && hipAngle === null) {
      activity = postureState.lastFullBodyPosture || "Sitting / rest";
      confidence = 0.60;
      signals = {
        posture: "unclear_legs_hidden",
        inferredFrom: postureState.lastFullBodyPosture || "default_assumption",
      };
    } else {
      activity = "Movement";
      confidence = 0.40;
      signals = { state: "posture_transition" };
    }
  }

  // ── MOVEMENT / UNKNOWN ─────────────────────────────────────────────────────
  else {
    activity = "Movement";
    confidence = 0.45;
    signals = { state: "transitioning" };
  }

  return { activity, confidence, signals };
}

// ── Smooth predictions ─────────────────────────────────────────────────────────
function smoothPredictions(currentActivity, history) {
  if (!history || history.length < 3) return currentActivity;
  const activityCounts = {};
  const recentWindow = history.slice(-5);
  recentWindow.forEach(item => {
    activityCounts[item.activity] = (activityCounts[item.activity] || 0) + 1;
  });
  const currentCount = activityCounts[currentActivity.activity] || 0;
  if (currentCount >= 4) {
    currentActivity.confidence = Math.min(0.97, currentActivity.confidence + 0.08);
  } else if (currentCount >= 3) {
    currentActivity.confidence = Math.min(0.90, currentActivity.confidence + 0.03);
  }
  return currentActivity;
}

// ── Stop Detection ─────────────────────────────────────────────────────────────
export async function stopPoseDetection() {
  isRunning = false;

  if (videoElement && videoElement.srcObject) {
    const stream = videoElement.srcObject;
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  if (detector) { detector.dispose(); detector = null; }
  if (faceDetector) { faceDetector.dispose(); faceDetector = null; }
  objectDetector = null;

  poseHistory = [];
  mouthHistory = [];
  lastDetectedObjects = [];
  activityHistory = [];
  featureHistory = [];
  actionMemory.detectedFoodObjects = [];
  actionMemory.detectedCups = [];
  actionMemory.detectedUtensils = [];
  actionMemory.lastBedSeen = 0;

  postureState.lastFullBodyPosture = null;
  postureState.sittingStreak = 0;
  postureState.standingStreak = 0;

  if (lstmModel) {
    lstmModel.dispose();
    lstmModel = null;
    lstmReady = false;
  }

  console.log("Pose detection stopped");
  isInitializing = false;
}

export function isPoseDetectionRunning() {
  return isRunning;
}
