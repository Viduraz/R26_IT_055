import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);

    timers.current[id] = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      delete timers.current[id];
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ── Toast Container UI ────────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

const TYPE_STYLES = {
  success: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  error:   'border-rose-500/50 bg-rose-500/10 text-rose-300',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  info:    'border-cyan-500/50 bg-cyan-500/10 text-cyan-300',
};

const TYPE_ICONS = {
  success: '✅',
  error:   '❌',
  warning: '⚠️',
  info:    'ℹ️',
};

function ToastItem({ toast, onRemove }) {
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  const icon = TYPE_ICONS[toast.type] || TYPE_ICONS.info;

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border
        backdrop-blur-md shadow-card text-sm font-medium
        animate-slide-in-right cursor-pointer
        ${style}
      `}
      onClick={() => onRemove(toast.id)}
    >
      <span>{icon}</span>
      <span>{toast.message}</span>
    </div>
  );
}
