/**
 * auth-service/frontend/src/utils/pose.js
 *
 * Helpers built on top of the 33-point MediaPipe Pose keypoints returned by
 * the skeleton-identification gateway (same indices as
 * skeleton-identification/backend/services/pose_estimation/estimator.py).
 */

// Head/face-related landmark indices (0-10) — the only ones present when the
// camera is framed close on the face (shoulders/hips/legs out of frame).
const NOSE = 0, L_EYE = 2, R_EYE = 5, L_EAR = 7, R_EAR = 8;

export const SKELETON_CONNECTIONS = [
  [11, 13], [13, 15], [12, 14], [14, 16], // Arms
  [11, 12], [23, 24],                     // Shoulders, Hips
  [11, 23], [12, 24],                     // Torso
  [23, 25], [25, 27], [24, 26], [26, 28], // Legs
  [0, 11], [0, 12],                       // Head to shoulders
];

const FULL_BODY_INDICES = [11, 12, 23, 24, 25, 26, 27, 28];

/**
 * Coarse head yaw signal derived from the head landmarks (nose offset from the
 * ear midpoint, normalized by ear span). Not a proper Euler angle (that would
 * need a dedicated face mesh model) — good enough to tell "turned away from
 * center" and, combined with the per-session baseline/adaptive-sign
 * calibration in FaceEnrollmentStep, to reliably distinguish left/right turns
 * regardless of camera mirroring.
 */
export function estimateHeadPose(keypoints) {
  if (!keypoints || keypoints.length < 9) return { faceVisible: false };

  const nose = keypoints[NOSE];
  const lEye = keypoints[L_EYE];
  const rEye = keypoints[R_EYE];
  const lEar = keypoints[L_EAR];
  const rEar = keypoints[R_EAR];

  const faceVisible =
    nose.visibility > 0.5 && lEye.visibility > 0.3 && rEye.visibility > 0.3;
  if (!faceVisible) return { faceVisible: false };

  const earMidX = (lEar.x + rEar.x) / 2;
  const earSpan = Math.max(Math.abs(lEar.x - rEar.x), 0.02);
  const yaw = (nose.x - earMidX) / (earSpan / 2);

  return {
    faceVisible: true,
    yaw: clamp(yaw, -2.5, 2.5),
    earLeftVisible: lEar.visibility > 0.35,
    earRightVisible: rEar.visibility > 0.35,
  };
}

/** True once enough lower-body landmarks are visible to frame a full-body shot. */
export function isFullBodyVisible(keypoints, minVisibility = 0.35) {
  if (!keypoints || keypoints.length < 29) return false;
  const visibleCount = FULL_BODY_INDICES.filter(
    (i) => keypoints[i] && keypoints[i].visibility > minVisibility
  ).length;
  return visibleCount >= FULL_BODY_INDICES.length - 1; // allow exactly one occluded joint
}

/** Average per-keypoint movement between two keypoint sets — used to detect "holding still". */
export function keypointMovement(prev, curr) {
  if (!prev || !curr || prev.length !== curr.length) return Infinity;
  let total = 0;
  let count = 0;
  for (let i = 0; i < curr.length; i++) {
    const a = prev[i], b = curr[i];
    if (!a || !b || b.visibility < 0.3) continue;
    total += Math.hypot(a.x - b.x, a.y - b.y);
    count += 1;
  }
  return count === 0 ? Infinity : total / count;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Draw the live skeleton (ported from skeleton-identification/frontend/src/utils/skeleton.js). */
export function drawSkeleton(ctx, keypoints, w, h, { color = "emerald" } = {}) {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!keypoints || keypoints.length === 0) return;

  const lineColor = color === "cyan" ? "rgba(0, 212, 255, 0.85)" : "rgba(52, 211, 153, 0.85)";

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  SKELETON_CONNECTIONS.forEach(([i, j]) => {
    const a = keypoints[i];
    const b = keypoints[j];
    if (a && b && a.visibility > 0.2 && b.visibility > 0.2) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  });

  keypoints.forEach((kp, idx) => {
    if (kp.visibility <= 0.2) return;
    const isBody = idx >= 11;
    ctx.beginPath();
    ctx.arc(kp.x * w, kp.y * h, 5, 0, Math.PI * 2);
    ctx.fillStyle = isBody ? "rgba(52, 211, 153, 0.95)" : "rgba(0, 212, 255, 0.9)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(kp.x * w, kp.y * h, 9, 0, Math.PI * 2);
    ctx.fillStyle = isBody ? "rgba(52, 211, 153, 0.15)" : "rgba(0, 212, 255, 0.12)";
    ctx.fill();
  });
}
