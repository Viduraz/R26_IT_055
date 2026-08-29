/**
 * Skeleton drawing utilities — ported from original app.js
 */

export const SKELETON_CONNECTIONS = [
  // Arms
  [11, 13], [13, 15], [12, 14], [14, 16],
  // Shoulders & Torso
  [11, 12], [23, 24],
  [11, 23], [12, 24],
  // Legs
  [23, 25], [25, 27], [24, 26], [26, 28],
  // Head & Neck
  [0, 11], [0, 12],
  // Face & Ears contours
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 7], [12, 8],
];

/**
 * Draw one person's skeleton keypoints + cyber-green bone connections onto an
 * already-prepared canvas (does NOT clear it — callers own that).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} keypoints — array of {x, y, visibility}
 * @param {number} w — canvas width
 * @param {number} h — canvas height
 */
function drawSkeletonLines(ctx, keypoints, w, h) {
  if (!keypoints || keypoints.length === 0) return;

  // Draw glowing bone lines
  ctx.strokeStyle = '#22c55e'; // Bright vibrant green
  ctx.lineWidth = 3.0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  SKELETON_CONNECTIONS.forEach(([i, j]) => {
    const a = keypoints[i];
    const b = keypoints[j];
    if (a && b && a.visibility > 0.02 && b.visibility > 0.02) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  });

  // Draw joint nodes with halo glow
  keypoints.forEach((kp, idx) => {
    if (kp.visibility > 0.02) {
      const kx = kp.x * w;
      const ky = kp.y * h;

      // Outer halo
      ctx.beginPath();
      ctx.arc(kx, ky, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = idx >= 11 ? 'rgba(34, 197, 94, 0.35)' : 'rgba(56, 189, 248, 0.35)';
      ctx.fill();

      // Inner solid node
      ctx.beginPath();
      ctx.arc(kx, ky, 4.0, 0, Math.PI * 2);
      ctx.fillStyle = idx >= 11 ? '#4ade80' : '#38bdf8';
      ctx.fill();
    }
  });
}

/**
 * Draw skeleton keypoints and connections for a single person on a canvas
 * (clears the canvas first) along with bounding box, facial box, and identification badges.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} keypoints  — array of {x, y, visibility}
 * @param {number} w — canvas width
 * @param {number} h — canvas height
 * @param {object} data — frame identification result
 */
export function drawSkeleton(ctx, keypoints, w, h, data = null) {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!keypoints || keypoints.length === 0) return;

  // 1. Draw glowing skeleton bone lines and joint nodes
  drawSkeletonLines(ctx, keypoints, w, h);

  // 2. Draw bounding box and identification badge if person is detected
  if (data && data.detected) {
    const personObj = (data.persons && data.persons[0]) || data;
    const bbox = personObj.bbox || data.bbox;

    if (bbox && bbox.length === 4) {
      const [x1, y1, x2, y2] = bbox;
      const px = x1 * w;
      const py = y1 * h;
      const boxW = (x2 - x1) * w;
      const boxH = (y2 - y1) * h;

      const state = personObj.state || data.state || 'analyzing';
      const name = personObj.name || data.name || (data.identification && data.identification.user) || 'Analyzing Posture...';
      const role = personObj.role || data.role || 'Caregiver';
      const confidence = personObj.confidence ?? data.confidence ?? 0;
      const isKnown = personObj.is_known ?? data.is_known ?? false;
      const progress = personObj.analysis_progress ?? data.analysis_progress;

      const isAnalyzing = state === 'analyzing' || (typeof name === 'string' && name.startsWith('Analyzing'));
      const isIdentified = isKnown && name !== 'Unknown' && name !== 'Unknown Person' && !isAnalyzing;

      let boxColor = '#38bdf8'; // Cyan default
      let tagColor = '#0284c7';

      if (isAnalyzing) {
        boxColor = '#06b6d4'; // Cyan
        tagColor = '#0284c7';
      } else if (isIdentified) {
        boxColor = '#10b981'; // Emerald Green
        tagColor = confidence >= 0.85 ? '#10b981' : '#f59e0b';
      } else {
        boxColor = '#f43f5e'; // Rose Red
        tagColor = '#f43f5e';
      }

      // Outer bounding box
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px, py, boxW, boxH);

      // Inner face box if head landmarks are present
      const headKps = keypoints.slice(0, 11).filter(k => k.visibility > 0.05);
      if (headKps.length >= 2) {
        const hxs = headKps.map(k => k.x * w);
        const hys = headKps.map(k => k.y * h);
        const fMinX = Math.min(...hxs) - 8;
        const fMaxX = Math.max(...hxs) + 8;
        const fMinY = Math.min(...hys) - 10;
        const fMaxY = Math.max(...hys) + 12;
        ctx.strokeStyle = isIdentified ? '#22c55e' : (isAnalyzing ? '#06b6d4' : '#f43f5e');
        ctx.lineWidth = 2;
        ctx.strokeRect(fMinX, fMinY, fMaxX - fMinX, fMaxY - fMinY);
      }

      // Analysis progress bar
      if (isAnalyzing && progress != null) {
        const progW = boxW * Math.min(Math.max(progress, 0.05), 1.0);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
        ctx.fillRect(px, py - 4, boxW, 3);
        ctx.fillStyle = '#06b6d4';
        ctx.fillRect(px, py - 4, progW, 3);
      }

      // Label badge
      const confPct = Math.round((confidence || 0) * 100);
      const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';

      let label = '';
      if (isAnalyzing) {
        label = `🔍 ${name}`;
      } else if (isIdentified) {
        label = `✓ ${name}${roleLabel ? ' · ' + roleLabel : ''} · ${confPct}%`;
      } else {
        label = `⚠️ Unknown Person · ${confPct}%`;
      }

      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(label).width;
      const badgeH = 22;
      const badgeW = textWidth + 16;
      const badgeY = Math.max(py - badgeH - 6, 4);

      ctx.fillStyle = tagColor;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, badgeY, badgeW, badgeH, 4);
      } else {
        ctx.rect(px, badgeY, badgeW, badgeH);
      }
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, px + 8, badgeY + 15);
    }
  }
}

/**
 * Clear a canvas entirely.
 */
export function clearCanvas(ctx, w, h) {
  if (ctx) ctx.clearRect(0, 0, w, h);
}

/**
 * Compatibility alias for drawSkeleton.
 */
export function drawPersons(ctx, persons, w, h) {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!persons || persons.length === 0) return;
  const p = persons[0];
  drawSkeleton(ctx, p.keypoints, w, h, { detected: true, persons: [p], ...p });
}
