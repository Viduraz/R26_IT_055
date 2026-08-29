import { useRef, useCallback, useEffect } from 'react';
import { getWsUrl, getIpWsUrl } from '../services/api';
import { drawSkeleton, drawPersons, clearCanvas } from '../utils/skeleton';

/**
 * useWebSocket — manages the WebSocket lifecycle, frame sending, and skeleton rendering.
 *
 * @param {object} refs  — { videoRef, canvasRef, enrollVideoRef, enrollCanvasRef, ipcamImgRef }
 * @param {object} state — { isStreaming, isEnrolling, enrollUserId, cameraSource, usePhoneCamera, phoneImage }
 * @param {object} cbs   — { onResult, onStatusChange, onFps, onEnrollFrame }
 */
export function useWebSocket(refs, state, cbs) {
  const wsRef = useRef(null);
  const frameTimerRef = useRef(null);
  const waitingRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());
  const stateRef = useRef(state);

  // Keep stateRef in sync with latest state
  useEffect(() => {
    stateRef.current = state;
  });

  // Offscreen canvas for frame capture
  const offscreenCanvas = useRef(document.createElement('canvas'));
  offscreenCanvas.current.width = 480;
  offscreenCanvas.current.height = 360;
  const offscreenCtx = useRef(offscreenCanvas.current.getContext('2d'));

  const handleResult = useCallback((data) => {
    const { isEnrolling } = stateRef.current;
    const canvasRef = isEnrolling ? refs.enrollCanvasRef : refs.canvasRef;
    const canvas = canvasRef?.current;

    if (!data.detected) {
      if (canvas) clearCanvas(canvas.getContext('2d'), canvas.width, canvas.height);
      cbs.onResult?.({ detected: false, ...data });
      return;
    }

    if (data.keypoints && canvas) {
      drawSkeleton(canvas.getContext('2d'), data.keypoints, canvas.width, canvas.height, data);
    }

    if (isEnrolling && data.mode === 'enroll' && data.features_ok) {
      cbs.onEnrollFrame?.(data);
    }

    cbs.onResult?.({ detected: true, ...data });
  }, [refs, cbs]);

  const sendFrame = useCallback(() => {
    frameTimerRef.current = null;
    const { isStreaming, isEnrolling, enrollUserId, usePhoneCamera, phoneImage } = stateRef.current;
    const ws = wsRef.current;

    if (!isStreaming || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (waitingRef.current) return;
    if (ws.bufferedAmount > 15000) {
      frameTimerRef.current = setTimeout(sendFrame, 50);
      return;
    }

    let source;
    if (isEnrolling && usePhoneCamera) {
      if (!phoneImage || !phoneImage.complete) return;
      source = phoneImage;
    } else {
      source = isEnrolling ? refs.enrollVideoRef?.current : refs.videoRef?.current;
    }

    if (!source || (source.tagName === 'VIDEO' && source.readyState < 2)) {
      frameTimerRef.current = setTimeout(sendFrame, 100);
      return;
    }

    try {
      offscreenCtx.current.drawImage(source, 0, 0, 480, 360);
      const dataUrl = offscreenCanvas.current.toDataURL('image/jpeg', 0.4);
      const base64 = dataUrl.split(',')[1];

      ws.send(JSON.stringify({
        frame: base64,
        mode: isEnrolling ? 'enroll' : 'identify',
        user_id: isEnrolling ? enrollUserId : null,
        enroll_type: stateRef.current.enrollType || 'skeleton',
        detect_mode: stateRef.current.detectMode || 'single',
      }));

      waitingRef.current = true;

      if (isEnrolling && usePhoneCamera && phoneImage) {
        const baseUrl = stateRef.current.phoneCameraUrl?.split('?')[0];
        if (baseUrl) phoneImage.src = `${baseUrl}?t=${Date.now()}`;
      }
    } catch (e) {
      console.warn('Frame capture error:', e);
      waitingRef.current = false;
    }

    // FPS counter
    frameCountRef.current++;
    const now = Date.now();
    if (now - lastFpsTimeRef.current >= 1000) {
      cbs.onFps?.(frameCountRef.current);
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  }, [refs, cbs]);

  const scheduleFrame = useCallback((delay = 0) => {
    if (!stateRef.current.isStreaming || frameTimerRef.current) return;
    if (delay === 0) {
      frameTimerRef.current = requestAnimationFrame(() => {
        frameTimerRef.current = null;
        sendFrame();
      });
    } else {
      frameTimerRef.current = setTimeout(sendFrame, delay);
    }
  }, [sendFrame]);

  const connect = useCallback((isIpCam = false, rtspUrl = '') => {
    if (wsRef.current) wsRef.current.close();

    const url = isIpCam ? getIpWsUrl() : getWsUrl();
    wsRef.current = new WebSocket(url);

    wsRef.current.onopen = () => {
      cbs.onStatusChange?.(true);
      waitingRef.current = false;
      if (isIpCam && rtspUrl) {
        wsRef.current.send(JSON.stringify({
          cmd: 'set_rtsp',
          url: rtspUrl,
          detect_mode: stateRef.current.detectMode || 'single',
        }));
      }
      if (!isIpCam && stateRef.current.isStreaming) {
        scheduleFrame();
      }
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      waitingRef.current = false;

      if (isIpCam) {
        // IP cam pushes frames as base64
        if (refs.ipcamImgRef?.current && data.camera_frame) {
          refs.ipcamImgRef.current.src = `data:image/jpeg;base64,${data.camera_frame}`;
        }
        // FPS for ip cam
        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsTimeRef.current >= 1000) {
          cbs.onFps?.(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsTimeRef.current = now;
        }
      }

      handleResult(data);

      if (!isIpCam && stateRef.current.isStreaming) {
        scheduleFrame(0);
      }
    };

    wsRef.current.onclose = () => {
      cbs.onStatusChange?.(false);
    };

    wsRef.current.onerror = (err) => {
      console.error('WS error', err);
      cbs.onStatusChange?.(false);
    };
  }, [cbs, handleResult, scheduleFrame, refs]);

  const disconnect = useCallback(() => {
    waitingRef.current = false;
    if (frameTimerRef.current) {
      cancelAnimationFrame(frameTimerRef.current);
      clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  return { connect, disconnect, scheduleFrame, wsRef };
}
