import { useState, useEffect, useCallback } from 'react';
import { fetchUsers, deleteUser } from '../services/api';
import { useToast } from '../context/ToastContext';
import LoadingSpinner from '../components/LoadingSpinner';

const STATUS_STYLES = {
  enrolled:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  pending:     'bg-amber-500/15 text-amber-400 border-amber-500/20',
  incomplete:  'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

export default function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch {
      toast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (userId, name) => {
    if (!confirm(`Delete "${name}" and all their data?`)) return;
    setDeletingId(userId);
    try {
      await deleteUser(userId);
      toast(`User "${name}" deleted`, 'success');
      setUsers(prev => prev.filter(u => u.user_id !== userId));
    } catch {
      toast('Failed to delete user', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-slate-400">{users.length} user{users.length !== 1 ? 's' : ''} enrolled</p>
        </div>
        <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
          {loading ? <LoadingSpinner size="sm" /> : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
          )}
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" label="Loading users…" />
        </div>
      ) : users.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {users.map(user => (
            <UserCard
              key={user.user_id}
              user={user}
              onDelete={handleDelete}
              deleting={deletingId === user.user_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserCard({ user, onDelete, deleting }) {
  const statusStyle = STATUS_STYLES[user.enrollment_status] || STATUS_STYLES.incomplete;

  return (
    <div className="glass-card p-4 hover:border-white/10 transition-all duration-200 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="
            w-11 h-11 rounded-xl flex items-center justify-center
            text-lg font-bold flex-shrink-0
            bg-gradient-to-br from-violet-500/30 to-cyan-500/30
            border border-violet-500/20 text-violet-300
          ">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100 truncate">{user.name}</div>
            <div className="text-xs text-slate-500 font-mono truncate">{user.user_id.substring(0, 12)}…</div>
          </div>
        </div>
        <button
          onClick={() => onDelete(user.user_id, user.name)}
          disabled={deleting}
          className="
            w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
            text-slate-500 hover:text-rose-400 hover:bg-rose-500/10
            transition-all duration-200 disabled:opacity-50
          "
          title="Delete user"
        >
          {deleting ? (
            <LoadingSpinner size="sm" />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusStyle}`}>
          {user.enrollment_status}
        </span>
        <span className="text-xs text-slate-500">{user.enrollment_frames_count} frames</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-dark-600/60 flex items-center justify-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
        </svg>
      </div>
      <p className="text-slate-400 text-sm mb-1">No users enrolled yet</p>
      <p className="text-slate-500 text-xs">Go to the Enroll tab to add users.</p>
    </div>
  );
}
