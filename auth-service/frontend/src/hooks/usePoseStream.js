/**
 * auth-service/frontend/src/hooks/usePoseStream.js
 *
 * Streams webcam frames to the skeleton-identification gateway's
 * `/ws/stream` endpoint (mode: "identify") and reports back the raw
 * MediaPipe Pose keypoints for every frame. Used to drive real-time,
 * detection-based UI (auto face-angle recognition, live skeleton overlay)
 * instead of a decorative/fake animation.
 *
 * This intentionally never uses mode: "enroll" — during signup no user
 * account exists yet in the skeleton-identification system, so we only
 * borrow its pose detector for live feedback. The actual enrollment
 * frames are still submitted in bulk at final registration, exactly as
 * before (see authApi.registerUser).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
// If VITE_SKELETON_WS_URL is set, use it. Otherwise seamlessly figure it out. 
// When using the reverse proxy / Cloudflare tunnel, it will go to window.location.host
const DEFAULT_WS_URL = import.meta.env.VITE_SKELETON_WS_URL || `${protocol}//${window.location.host}/ws/stream`;
const SEND_INTERVAL_MS = 150; // ~6-7 fps — enough for smooth tracking without overloading the pose model

export function usePoseStream({ enabled, getSourceElement, onResult, retryToken = 0 }) {
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const wsRef = useRef(null);
  const timerRef = useRef(null);
  const waitingRef = useRef(false);
  const onResultRef = useRef(onResult);
  const getSourceRef = useRef(getSourceElement);
  const offscreen = useRef(null);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { getSourceRef.current = getSourceElement; }, [getSourceElement]);

  if (!offscreen.current) {
    const cv = document.createElement("canvas");
    cv.width = 480;
    cv.height = 360;
    offscreen.current = { canvas: cv, ctx: cv.getContext("2d") };
  }

  const sendFrame = useCallback(() => {
    timerRef.current = null;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (waitingRef.current) return;
    if (ws.bufferedAmount > 15000) {
      timerRef.current = setTimeout(sendFrame, 100);
      return;
    }

    const source = getSourceRef.current?.();
    if (!source || (source.tagName === "VIDEO" && source.readyState < 2)) {
      timerRef.current = setTimeout(sendFrame, 100);
      return;
    }

    try {
      const { canvas, ctx } = offscreen.current;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
      const base64 = dataUrl.split(",")[1];

      ws.send(JSON.stringify({ frame: base64, mode: "identify" }));
      waitingRef.current = true;
    } catch (err) {
      waitingRef.current = false;
      timerRef.current = setTimeout(sendFrame, SEND_INTERVAL_MS);
    }
  }, []);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(sendFrame, SEND_INTERVAL_MS);
  }, [sendFrame]);

  useEffect(() => {
    if (!enabled) return undefined;

    const ws = new WebSocket(DEFAULT_WS_URL);
    wsRef.current = ws;
    setConnectionError(null);

    ws.onopen = () => {
      setConnected(true);
      waitingRef.current = false;
      scheduleNext();
    };

    ws.onmessage = (event) => {
      waitingRef.current = false;
      try {
        const data = JSON.parse(event.data);
        onResultRef.current?.(data);
      } catch {
        /* ignore malformed frame */
      }
      scheduleNext();
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
      setConnectionError(
        `Cannot reach the skeleton-identification detection service. Make sure it is running. (${DEFAULT_WS_URL})`
      );
    };

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      waitingRef.current = false;
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
      setConnected(false);
    };
  }, [enabled, scheduleNext, retryToken]);

  return { connected, connectionError };
}
