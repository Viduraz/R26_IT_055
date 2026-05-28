import { useState, useEffect, useCallback } from 'react';
import { trainModel, fetchHealth } from '../services/api';
import { useToast } from '../context/ToastContext';
import LoadingSpinner from '../components/LoadingSpinner';

const MODEL_TYPES = [
  { value: 'ensemble', label: 'Ensemble (SVM + LSTM)' },
  { value: 'svm',      label: 'SVM Only' },
  { value: 'lstm',     label: 'LSTM Only' },
];

export default function TrainingPage() {
  const toast = useToast();
  const [modelType, setModelType] = useState('ensemble');
  const [epochs, setEpochs] = useState(100);
  const [training, setTraining] = useState(false);
  const [results, setResults] = useState(null);
  const [modelStatus, setModelStatus] = useState({ svm: false, lstm: false });

  const loadStatus = useCallback(async () => {
    try {
      const health = await fetchHealth();
      setModelStatus(health.models || { svm: false, lstm: false });
    } catch {
      // server may not be running yet
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleTrain = async () => {
    setTraining(true);
    setResults(null);
    try {
      const result = await trainModel(modelType, epochs);
      if (result.success) {
        toast('Training complete! ✅', 'success');
        setResults(result);
        await loadStatus();
      } else {
        toast(`Training failed: ${result.detail || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">

        {/* Train Card */}
        <div className="glass-card p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-1">Train Models</h2>
            <p className="text-xs text-slate-500">Train SVM and LSTM models using all enrolled user data.</p>
          </div>

          <div>
            <label className="form-label">Model Type</label>
            <select
              value={modelType}
              onChange={e => setModelType(e.target.value)}
              className="form-select"
              disabled={training}
            >
              {MODEL_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">LSTM Epochs</label>
            <input
              type="number"
              value={epochs}
              min={10}
              max={500}
              onChange={e => setEpochs(parseInt(e.target.value) || 100)}
              className="form-input"
              disabled={training}
            />
          </div>

          <button
            onClick={handleTrain}
            disabled={training}
            className="btn btn-primary btn-block"
          >
            {training ? (
              <>
                <LoadingSpinner size="sm" />
                Training in progress…
              </>
            ) : (
              <>🚀 Start Training</>
            )}
          </button>

          {training && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 animate-fade-in">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs text-cyan-300">Training in progress… this may take a few minutes.</span>
            </div>
          )}
        </div>

        {/* Model Status */}
        <div className="space-y-4">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Model Status</h2>
              <button onClick={loadStatus} className="text-xs text-slate-500 hover:text-cyan-400 transition-colors">
                Refresh
              </button>
            </div>

            <div className="space-y-3">
              <ModelCard
                label="SVM"
                subtitle="Support Vector Machine (RBF Kernel)"
                ready={modelStatus.svm}
                color="cyan"
              />
              <ModelCard
                label="LSTM"
                subtitle="Long Short-Term Memory Network"
                ready={modelStatus.lstm}
                color="violet"
              />
              <ModelCard
                label="Ensemble"
                subtitle="Weighted fusion of SVM + LSTM"
                ready={modelStatus.svm && modelStatus.lstm}
                color="emerald"
              />
            </div>
          </div>

          {/* Results */}
          {results && (
            <div className="glass-card p-5 animate-fade-in">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Training Results</h3>
              <pre className="
                text-xs font-mono text-slate-300
                bg-dark-800/60 rounded-lg p-3
                overflow-x-auto max-h-60
                border border-white/5
              ">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelCard({ label, subtitle, ready, color }) {
  const colors = {
    cyan:    { bg: 'bg-cyan-500/20',    text: 'text-cyan-300',    border: 'border-cyan-500/20' },
    violet:  { bg: 'bg-violet-500/20',  text: 'text-violet-300',  border: 'border-violet-500/20' },
    emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/20' },
  };
  const c = colors[color] || colors.cyan;

  return (
    <div className="flex items-center gap-4 p-3 rounded-xl bg-dark-600/40 border border-white/5">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${c.bg} ${c.text} border ${c.border}`}>
        {label}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 font-medium">{label}</div>
        <div className="text-xs text-slate-500 truncate">{subtitle}</div>
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${
        ready
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-dark-500 text-slate-500 border-white/5'
      }`}>
        {ready ? 'Trained ✅' : 'Not Trained'}
      </span>
    </div>
  );
}
