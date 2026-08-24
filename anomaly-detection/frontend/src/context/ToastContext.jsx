/**
 * anomaly-detection/frontend/src/context/ToastContext.jsx
 * Global toast notification context for critical anomaly alerts.
 */
import { createContext, useContext, useState, useCallback, useRef } from "react";

const ToastContext = createContext(null);

const ANOMALY_TOAST_CONFIG = {
    fall_detected: { color: "red", icon: "🚨", title: "FALL DETECTED", sound: true },
    aggression_detected: { color: "orange", icon: "⚠️", title: "Aggression Detected", sound: true },
    prolonged_inactivity: { color: "yellow", icon: "😴", title: "Prolonged Inactivity", sound: false },
    inactivity_warning: { color: "yellow", icon: "⏱️", title: "Inactivity Warning", sound: false },
    unusual_movement: { color: "indigo", icon: "❓", title: "Unusual Movement", sound: false },
};

const COLOR_MAP = {
    red: { bg: "bg-red-900/95", border: "border-red-500", text: "text-red-200", bar: "bg-red-500" },
    orange: { bg: "bg-orange-900/95", border: "border-orange-500", text: "text-orange-200", bar: "bg-orange-500" },
    yellow: { bg: "bg-yellow-900/90", border: "border-yellow-500", text: "text-yellow-200", bar: "bg-yellow-400" },
    indigo: { bg: "bg-indigo-900/90", border: "border-indigo-500", text: "text-indigo-200", bar: "bg-indigo-500" },
};

let _toastIdCounter = 0;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const timersRef = useRef({});

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }
    }, []);

    /**
     * Fire a toast for an anomaly event.
     * @param {string} anomalyType  - e.g. "fall_detected"
     * @param {number} confidence   - 0-1
     * @param {string} personId     - patient identifier
     * @param {string} [severity]
     */
    const fireAnomalyToast = useCallback((anomalyType, confidence, personId, severity) => {
        const cfg = ANOMALY_TOAST_CONFIG[anomalyType];
        if (!cfg) return; // don't toast normal_activity / no_person

        const id = ++_toastIdCounter;
        const toast = {
            id,
            anomalyType,
            confidence,
            personId,
            severity: severity || "none",
            ...cfg,
            timestamp: new Date().toLocaleTimeString(),
        };

        setToasts(prev => [toast, ...prev].slice(0, 5)); // max 5 concurrent toasts

        // Auto-dismiss after 6s (critical) or 4s (others)
        const ttl = cfg.color === "red" ? 6000 : 4000;
        timersRef.current[id] = setTimeout(() => dismiss(id), ttl);
    }, [dismiss]);

    return (
        <ToastContext.Provider value={{ fireAnomalyToast, dismiss, toasts }}>
            {children}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
    return ctx;
}

export { ANOMALY_TOAST_CONFIG, COLOR_MAP };
