import { useState, useEffect, useCallback } from 'react';
import { fetchStats, downloadReportPdf } from '../services/api';
import { useToast } from '../context/ToastContext';
import LoadingSpinner from '../components/LoadingSpinner';

export default function StatsPage() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchStats();
      setStats(data);
    } catch {
      toast('Failed to load statistics', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const blob = await downloadReportPdf();
      const url  = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `identification-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast('PDF report downloaded', 'success');
    } catch (err) {
      toast(`Failed to download report: ${err.message}`, 'error');
    } finally {
      setDownloading(false);
    }
  };

  const idStats = stats?.identification_stats || {};
  const recent  = stats?.recent_identifications || [];

  const statCards = [
    { label: 'Enrolled Users',       value: stats?.total_users ?? 0 },
    { label: 'Total Identifications', value: idStats.total_identifications ?? 0 },
    { label: 'Avg Confidence',        value: `${Math.round((idStats.avg_confidence ?? 0) * 100)}%` },
    { label: 'Avg Latency',           value: `${Math.round(idStats.avg_latency_ms ?? 0)}ms` },
  ];

  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="btn btn-secondary btn-sm"
        >
          {downloading ? <LoadingSpinner size="sm" /> : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          )}
          Download PDF Report
        </button>
        <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" label="Loading statistics…" />
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map(({ label, value }) => (
              <StatCard key={label} label={label} value={value} />
            ))}
          </div>

          {/* Recent Identifications Table */}
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5">
              <h3 className="text-sm font-semibold text-slate-300">Recent Identifications</h3>
            </div>
            {recent.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">No identification data yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Identified As</th>
                      <th>Confidence</th>
                      <th>Latency</th>
                      <th>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{new Date(r.timestamp).toLocaleTimeString()}</td>
                        <td className="font-medium">{r.predicted_user_id || 'Unknown'}</td>
                        <td>
                          <ConfidencePill value={Math.round((r.confidence || 0) * 100)} />
                        </td>
                        <td className="font-mono text-xs">{Math.round(r.latency_ms || 0)}ms</td>
                        <td className="text-slate-400 text-xs">{r.model_version || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="glass-card p-5 hover:border-white/10 transition-all duration-200">
      <div className="text-2xl font-bold text-gradient-cyan mb-1 font-mono">{value}</div>
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function ConfidencePill({ value }) {
  const color = value >= 75 ? 'bg-emerald-500/15 text-emerald-400' :
                value >= 50 ? 'bg-amber-500/15 text-amber-400' :
                              'bg-rose-500/15 text-rose-400';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-medium ${color}`}>
      {value}%
    </span>
  );
}
