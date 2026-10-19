import { useState, useEffect, useCallback } from 'react';
import { fetchUsers, deleteUser } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import LoadingSpinner from '../components/LoadingSpinner';

const ROLE_COLORS = {
  caregiver: 'text-violet-400 border-violet-500/20 bg-violet-500/10',
  patient:   'text-cyan-400 border-cyan-500/20 bg-cyan-500/10',
  guardian:  'text-rose-400 border-rose-500/20 bg-rose-500/10',
};

export default function FaceUsersPage() {
  const toast = useToast();
  const { setActiveTab } = useApp();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUsers();
      // Filter to only show users enrolled through FaceRecognitionPage
      const faceUsers = data.filter(u => u.notes === 'face_recognition');
      setUsers(faceUsers);
    } catch {
      toast('Failed to load biometric profiles', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (userId, name) => {
    if (!confirm(`Permanently remove biometric data for "${name}"?`)) return;
    setDeletingId(userId);
    try {
      await deleteUser(userId);
      toast(`Profile "${name}" removed`, 'success');
      setUsers(prev => prev.filter(u => u.user_id !== userId));
    } catch {
      toast('Failed to remove profile', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient-cyan">Face ID Biometric Profiles</h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">High-Fidelity Multi-Angle Identity Records</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveTab('face')} className="btn btn-primary btn-sm flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            + Enroll New Face
          </button>
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
            {loading ? <LoadingSpinner size="sm" /> : 'Sync Database'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" label="Scanning identity database…" />
        </div>
      ) : users.length === 0 ? (
        <div className="glass-card py-20 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-dark-600 flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500">
              <path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5z"/>
              <path d="M20 21a8 8 0 0 0-16 0"/>
            </svg>
          </div>
          <p className="text-slate-400 text-sm">No face profiles found</p>
          <p className="text-slate-500 text-xs mt-1">Enroll users in the Face Recognition tab.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {users.map(user => (
            <div key={user.user_id} className="glass-card group overflow-hidden hover:border-cyan-500/30 transition-all duration-300">
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative w-14 h-14 rounded-2xl bg-dark-800 border border-white/5 flex items-center justify-center text-xl font-bold text-cyan-400 overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent" />
                      {user.name.charAt(0).toUpperCase()}
                      {/* Scanning line effect on hover */}
                      <div className="absolute top-0 left-0 w-full h-0.5 bg-cyan-400 shadow-glow-cyan opacity-0 group-hover:animate-scan-slow group-hover:opacity-100" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-100">{user.name}</h3>
                      <div className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${ROLE_COLORS[user.role] || ROLE_COLORS.caregiver}`}>
                        {user.role}
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(user.user_id, user.name)}
                    disabled={deletingId === user.user_id}
                    className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    {deletingId === user.user_id ? <LoadingSpinner size="sm" /> : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    )}
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-dark-900/50 border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Status</div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${(user.enrollment_status === 'completed' || user.face_verification_status === 'enrolled') ? 'bg-emerald-500 shadow-glow-emerald' : 'bg-amber-500'}`} />
                      <span className="text-xs font-mono text-slate-300 capitalize">
                        {(user.enrollment_status === 'completed' || user.face_verification_status === 'enrolled') ? 'completed' : (user.enrollment_status || 'pending')}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-dark-900/50 border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Samples</div>
                    <div className="text-xs font-mono text-cyan-400 font-bold">
                      {user.enrollment_frames_count || (user.face_verification_status === 'enrolled' || user.face_embeddings ? 30 : 0)} Frames
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 bg-white/2 border-t border-white/5 flex justify-between items-center">
                <span className="text-[10px] font-mono text-slate-500">{user.user_id}</span>
                <div className="flex gap-1">
                   <div className="w-1 h-1 rounded-full bg-cyan-500/40" />
                   <div className="w-1 h-1 rounded-full bg-cyan-500/40" />
                   <div className="w-1 h-1 rounded-full bg-cyan-500/40" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scan-slow {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .group-hover\\:animate-scan-slow {
          animation: scan-slow 2s linear infinite;
        }
      `}} />
    </div>
  );
}
