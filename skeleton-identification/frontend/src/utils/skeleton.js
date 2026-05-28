/**
 * Skeleton drawing utilities — ported from original app.js
 */

export const SKELETON_CONNECTIONS = [
  [11, 13], [13, 15], [12, 14], [14, 16], // Arms
  [11, 12], [23, 24],                       // Shoulders, Hips
  [11, 23], [12, 24],                       // Torso
  [23, 25], [25, 27], [24, 26], [26, 28],  // Legs
  [0, 11], [0, 12],                         // Head to shoulders
];

/**
 * Draw skeleton keypoints and connections on a canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} keypoints  — array of {x, y, visibility}
 * @param {number} w — canvas width
 * @param {number} h — canvas height
 */
export function drawSkeleton(ctx, keypoints, w, h) {
  if (!ctx || !keypoints || keypoints.length === 0) return;

  ctx.clearRect(0, 0, w, h);

  // Draw connections
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.75)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

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

  // Draw keypoints
  keypoints.forEach((kp, idx) => {
    if (kp.visibility > 0.2) {
      ctx.beginPath();
      ctx.arc(kp.x * w, kp.y * h, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = idx >= 11
        ? 'rgba(52, 211, 153, 0.95)'   // body joints — emerald
        : 'rgba(0, 212, 255, 0.85)';   // head/face — cyan
      ctx.fill();

      // Subtle glow
      ctx.beginPath();
      ctx.arc(kp.x * w, kp.y * h, 7, 0, Math.PI * 2);
      ctx.fillStyle = idx >= 11
        ? 'rgba(52, 211, 153, 0.12)'
        : 'rgba(0, 212, 255, 0.1)';
      ctx.fill();
    }
  });
}

/**
 * Clear a canvas entirely.
 */
export function clearCanvas(ctx, w, h) {
  if (ctx) ctx.clearRect(0, 0, w, h);
}
