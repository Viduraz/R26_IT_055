// gateway-dashboard/frontend/src/pages/AdminUsers.jsx
// Full user management panel — accessible from the Admin Dashboard stat tiles.
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { getAllUsers, updateUserStatus } from "../services/dashboardApi";
import { useAuth } from "@shared/hooks/useAuth";

// ── Icons ─────────────────────────────────────────────────────────────────────
const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const Search = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const X = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const Refresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const Eye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const Shield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROLE_COLORS = {
  admin:         { bg: "bg-indigo-500/15", text: "text-indigo-400", border: "border-indigo-500/30" },
  caregiver:     { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30" },
  family_member: { bg: "bg-blue-500/15",   text: "text-blue-400",   border: "border-blue-500/30"   },
};

const STATUS_COLORS = {
  approved: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400" },
  pending:  { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30",   dot: "bg-amber-400"  },
  rejected: { bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30",     dot: "bg-red-400"    },
};

const FACE_STATUS_COLORS = {
  enrolled: { text: "text-emerald-400", label: "Enrolled" },
  pending:  { text: "text-amber-400",   label: "Pending"  },
};

function roleLabel(role) {
  return { admin: "Admin", caregiver: "Caregiver", family_member: "Family" }[role] || role;
}

function getInitials(name = "") {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function avatarColor(name = "") {
  const colors = ["from-indigo-600 to-indigo-800", "from-purple-600 to-purple-800",
    "from-blue-600 to-blue-800", "from-cyan-600 to-cyan-800", "from-rose-600 to-rose-800",
    "from-emerald-600 to-emerald-800", "from-amber-600 to-amber-800"];
  const idx = name.charCodeAt(0) % colors.length;
  return colors[idx];
}

// ── Detail slide-over panel ───────────────────────────────────────────────────
function UserDetailPanel({ user, onClose, onStatusChange, loading }) {
  if (!user) return null;
  const role = ROLE_COLORS[user.role] || ROLE_COLORS.family_member;
  const statusCfg = STATUS_COLORS[user.approval_status] || STATUS_COLORS.pending;
  const isCaregiver = user.role === "caregiver";

  const fields = [
    { label: "Email",             value: user.email },
    { label: "Role",              value: roleLabel(user.role) },
    { label: "Contact Number",    value: user.contact_number || "—" },
    { label: "Date of Birth",     value: user.date_of_birth || "—" },
    { label: "Gender",            value: user.gender || "—" },
    { label: "ID Number",         value: user.id_number || "—" },
    { label: "Permanent Address", value: user.permanent_address || "—" },
    { label: "Office Address",    value: user.office_address || "—" },
    { label: "Relationship",      value: user.relationship_to_elder || "—" },
    { label: "Emergency Contact", value: user.emergency_contact_name ? `${user.emergency_contact_name} (${user.emergency_contact_number})` : "—" },
    { label: "Registered",        value: user.created_at ? new Date(user.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-md bg-[#0d1525] border-l border-white/10 flex flex-col overflow-y-auto animate-slide-in">
        {/* Header */}
        <div className="p-6 border-b border-white/8 flex items-center justify-between">
          <h2 className="font-semibold text-white">User Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8 text-gray-400 hover:text-white transition"><X /></button>
        </div>

        {/* Avatar + name */}
        <div className="p-6 flex items-center gap-4 border-b border-white/8">
          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarColor(user.name)} flex items-center justify-center text-white font-bold text-xl flex-shrink-0`}>
            {getInitials(user.name)}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-white truncate">{user.name || "Unknown"}</p>
            <p className="text-sm text-gray-400 truncate">{user.email}</p>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${role.bg} ${role.text} ${role.border}`}>{roleLabel(user.role)}</span>
              {isCaregiver && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${(FACE_STATUS_COLORS[user.face_verification_status] || FACE_STATUS_COLORS.pending).text} bg-white/5 border-white/10`}>
                  Face: {(FACE_STATUS_COLORS[user.face_verification_status] || FACE_STATUS_COLORS.pending).label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Approval status + action (caregivers only) */}
        {isCaregiver && (
          <div className="p-5 border-b border-white/8">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Approval Status</p>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${statusCfg.bg} ${statusCfg.border} mb-4`}>
              <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
              <span className={`text-sm font-semibold capitalize ${statusCfg.text}`}>{user.approval_status || "pending"}</span>
            </div>
            <div className="flex gap-2">
              <button
                disabled={user.approval_status === "approved" || loading}
                onClick={() => onStatusChange(user.id, "approved")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check /> Approve
              </button>
              <button
                disabled={user.approval_status === "rejected" || loading}
                onClick={() => onStatusChange(user.id, "rejected")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 text-red-400 hover:text-red-300 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X /> Reject
              </button>
              <button
                disabled={user.approval_status === "pending" || loading}
                onClick={() => onStatusChange(user.id, "pending")}
                className="py-2.5 px-3 rounded-xl bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/30 text-amber-400 hover:text-amber-300 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title="Reset to Pending"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Profile fields */}
        <div className="p-5 space-y-3 flex-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Profile Information</p>
          {fields.filter(f => f.value !== "—").map((f) => (
            <div key={f.label} className="flex justify-between gap-3">
              <span className="text-xs text-gray-500 flex-shrink-0 w-32">{f.label}</span>
              <span className="text-sm text-gray-200 text-right break-all">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slideIn 0.25s ease-out; }
      `}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const ROLE_FILTERS = ["all", "caregiver", "family_member", "admin"];
const STATUS_FILTERS = ["all", "pending", "approved", "rejected"];

export default function AdminUsers() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await getAllUsers(token);
      setUsers(res.users || []);
    } catch (err) {
      showToast("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleStatusChange = async (userId, newStatus) => {
    setActionLoading(true);
    try {
      await updateUserStatus(token, userId, newStatus);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approval_status: newStatus } : u));
      if (selected?.id === userId) setSelected((prev) => ({ ...prev, approval_status: newStatus }));
      showToast(`Status updated to ${newStatus}`, "success");
    } catch (err) {
      showToast(err.response?.data?.detail || "Update failed", "error");
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered list
  const filtered = users.filter((u) => {
    const matchRole   = roleFilter === "all" || u.role === roleFilter;
    const matchStatus = statusFilter === "all" || (u.approval_status || "pending") === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
    return matchRole && matchStatus && matchSearch;
  });

  const pendingCaregivers = users.filter((u) => u.role === "caregiver" && (!u.approval_status || u.approval_status === "pending")).length;

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #030712 0%, #0a0f1e 50%, #030712 100%)" }}>
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-64 h-64 bg-purple-600/5 rounded-full blur-3xl" />
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium transition-all ${
          toast.type === "success"
            ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300"
            : "bg-red-900/80 border-red-500/40 text-red-300"
        }`}>
          {toast.type === "success" ? <Check /> : <X />}
          {toast.msg}
        </div>
      )}

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <Link to="/admin" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition">
            <ChevronLeft /> Back to Dashboard
          </Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">User Management</h1>
          {pendingCaregivers > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400">
              {pendingCaregivers} caregiver{pendingCaregivers > 1 ? "s" : ""} pending approval
            </span>
          )}
          <button onClick={fetchUsers} className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-white/6 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white text-sm transition">
            <Refresh /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><Search /></span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/60 transition"
            />
          </div>

          {/* Role filter */}
          <div className="flex gap-1.5 bg-white/4 border border-white/8 rounded-xl p-1">
            {ROLE_FILTERS.map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  roleFilter === r ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {r === "all" ? "All Roles" : r === "family_member" ? "Family" : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex gap-1.5 bg-white/4 border border-white/8 rounded-xl p-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  statusFilter === s ? "bg-white/15 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {s === "all" ? "All Status" : s}
              </button>
            ))}
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total",    val: users.length,                                                              color: "text-white"        },
            { label: "Caregivers", val: users.filter(u => u.role === "caregiver").length,                      color: "text-purple-400"   },
            { label: "Pending",  val: users.filter(u => !u.approval_status || u.approval_status === "pending").length, color: "text-amber-400"  },
            { label: "Approved", val: users.filter(u => u.approval_status === "approved").length,               color: "text-emerald-400"  },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/8 bg-white/3 p-3 text-center">
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.val}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(13,21,37,0.7)" }}>
          {loading ? (
            <div className="p-12 text-center text-gray-600">
              <div className="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p>Loading users…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-600">
              <UserIcon />
              <p className="mt-2">No users match the current filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3.5 font-medium">User</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3.5 font-medium hidden sm:table-cell">Role</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3.5 font-medium hidden md:table-cell">Face Auth</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3.5 font-medium">Status</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3.5 font-medium hidden lg:table-cell">Registered</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((u) => {
                    const roleCfg = ROLE_COLORS[u.role] || ROLE_COLORS.family_member;
                    const statusCfg = STATUS_COLORS[u.approval_status] || STATUS_COLORS.pending;
                    const isCaregiver = u.role === "caregiver";
                    const isPending = !u.approval_status || u.approval_status === "pending";

                    return (
                      <tr key={u.id} className={`hover:bg-white/3 transition-colors group ${isPending && isCaregiver ? "bg-amber-500/3" : ""}`}>
                        {/* User */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${avatarColor(u.name)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                              {getInitials(u.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{u.name || "Unknown"}</p>
                              <p className="text-xs text-gray-500 truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        {/* Role */}
                        <td className="px-5 py-3.5 hidden sm:table-cell">
                          <span className={`text-xs px-2.5 py-1 rounded-full border ${roleCfg.bg} ${roleCfg.text} ${roleCfg.border}`}>
                            {roleLabel(u.role)}
                          </span>
                        </td>
                        {/* Face Auth */}
                        <td className="px-5 py-3.5 hidden md:table-cell">
                          {isCaregiver ? (
                            <span className={`text-xs ${(FACE_STATUS_COLORS[u.face_verification_status] || FACE_STATUS_COLORS.pending).text}`}>
                              {(FACE_STATUS_COLORS[u.face_verification_status] || FACE_STATUS_COLORS.pending).label}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-600">N/A</span>
                          )}
                        </td>
                        {/* Status + inline approve for pending caregivers */}
                        <td className="px-5 py-3.5">
                          {isCaregiver ? (
                            <div className="flex items-center gap-2">
                              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                                <span className="capitalize">{u.approval_status || "pending"}</span>
                              </span>
                              {isPending && (
                                <div className="hidden group-hover:flex gap-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleStatusChange(u.id, "approved"); }}
                                    disabled={actionLoading}
                                    className="p-1 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30 transition disabled:opacity-40"
                                    title="Approve"
                                  ><Check /></button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleStatusChange(u.id, "rejected"); }}
                                    disabled={actionLoading}
                                    className="p-1 rounded-lg bg-red-600/25 hover:bg-red-600/40 text-red-400 border border-red-500/30 transition disabled:opacity-40"
                                    title="Reject"
                                  ><X /></button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-600">—</span>
                          )}
                        </td>
                        {/* Registered */}
                        <td className="px-5 py-3.5 hidden lg:table-cell">
                          <span className="text-xs text-gray-500">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                          </span>
                        </td>
                        {/* View detail */}
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => setSelected(u)}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-400 transition px-2 py-1 rounded-lg hover:bg-indigo-500/10"
                          >
                            <Eye /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-600 text-right">Showing {filtered.length} of {users.length} users</p>
      </div>

      {/* Slide-over detail panel */}
      {selected && (
        <UserDetailPanel
          user={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
