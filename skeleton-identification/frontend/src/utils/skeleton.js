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
 * Draw one person's skeleton keypoints + green bone connections onto an
 * already-prepared canvas (does NOT clear it — callers own that).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} keypoints — array of {x, y, visibility}
 * @param {number} w — canvas width
 * @param {number} h — canvas height
 */
function drawSkeletonLines(ctx, keypoints, w, h) {
  if (!keypoints || keypoints.length === 0) return;

  ctx.strokeStyle = 'rgba(0, 212, 255, 0.75)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  SKELETON_CONNECTIONS.forEach(([i, j]) => {
    const a = keypoints[i];
    const b = keypoints[j];
    if (a && b && a.visibility > 0.05 && b.visibility > 0.05) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  });

  keypoints.forEach((kp, idx) => {
    if (kp.visibility > 0.05) {
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
 * Draw skeleton keypoints and connections for a single person on a canvas
 * (clears the canvas first).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} keypoints  — array of {x, y, visibility}
 * @param {number} w — canvas width
 * @param {number} h — canvas height
 */
export function drawSkeleton(ctx, keypoints, w, h) {
  if (!ctx || !keypoints || keypoints.length === 0) return;
  ctx.clearRect(0, 0, w, h);
  drawSkeletonLines(ctx, keypoints, w, h);
}

/**
 * Clear a canvas entirely.
 */
export function clearCanvas(ctx, w, h) {
  if (ctx) ctx.clearRect(0, 0, w, h);
}

/**
 * Draw the live green skeleton plus a bounding box + name label for every
 * detected person.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} persons — [{ bbox: [x1,y1,x2,y2] (normalized 0..1), name, confidence, is_known, keypoints }, ...]
 * @param {number} w — canvas width
 * @param {number} h — canvas height
 */
export function drawPersons(ctx, persons, w, h) {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!persons || persons.length === 0) return;

  persons.forEach((person, idx) => {
    drawSkeletonLines(ctx, person.keypoints, w, h);

    const [x1, y1, x2, y2] = person.bbox;
    const px = x1 * w;
    const py = y1 * h;
    const boxW = (x2 - x1) * w;
    const boxH = (y2 - y1) * h;

    const color = !person.is_known
      ? '#f43f5e'   // rose — unrecognized
      : person.confidence >= 0.85
        ? '#10b981' // emerald — high confidence
        : '#f59e0b'; // amber — recognized but lower confidence

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(px, py, boxW, boxH);

    const roleLabel = person.role ? person.role.charAt(0).toUpperCase() + person.role.slice(1) : '';
    const label = person.is_known
      ? `${person.name}${roleLabel ? ' · ' + roleLabel : ''} · ${Math.round(person.confidence * 100)}%`
      : `Person ${idx + 1}`;

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(label).width;
    const labelH = 20;
    const labelY = Math.max(py - labelH, 0);
    const labelW = textWidth + 14;

    ctx.fillStyle = color;
    ctx.fillRect(px, labelY, labelW, labelH);

    ctx.fillStyle = '#0b0f1a';
    ctx.fillText(label, px + 7, labelY + labelH - 6);
  });
}
