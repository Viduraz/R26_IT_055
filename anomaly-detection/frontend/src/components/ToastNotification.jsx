/**
 * anomaly-detection/frontend/src/components/ToastNotification.jsx
 * Overlay renderer for anomaly alert toasts. Mount once in App.jsx.
 */
import { useToast, COLOR_MAP } from "../context/ToastContext";

export default function ToastNotification() {
    const { toasts, dismiss } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
            {toasts.map((toast) => {
                const c = COLOR_MAP[toast.color] || COLOR_MAP.indigo;
                const isCritical = toast.color === "red";
                return (
                    <div
                        key={toast.id}
                        className={`
              pointer-events-auto
              flex items-start gap-3 px-4 py-4 rounded-2xl border-2 shadow-2xl
              backdrop-blur-md
              ${c.bg} ${c.border}
              toast-slide-in
              ${isCritical ? "animate-pulse" : ""}
            `}
                    >
                        {/* Icon */}
                        <span className="text-2xl shrink-0 mt-0.5">{toast.icon}</span>

                        {/* Body */}
                        <div className="flex-1 min-w-0">
                            <p className={`font-black text-sm tracking-wide ${c.text}`}>
                                {toast.title}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                                Patient: <span className="font-mono text-gray-300">{toast.personId}</span>
                                {" · "}
                                Confidence: <span className="font-mono">{(toast.confidence * 100).toFixed(0)}%</span>
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 font-mono">{toast.timestamp}</p>
                        </div>

                        {/* Progress bar + dismiss */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <button
                                onClick={() => dismiss(toast.id)}
                                className="text-gray-500 hover:text-white text-xs leading-none transition-colors"
                                aria-label="Dismiss"
                            >
                                ✕
                            </button>
                            {isCritical && (
                                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border border-red-500/50 text-red-300 bg-red-900/40`}>
                                    CRITICAL
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
