/**
 * API service layer — mirrors all endpoints from FastAPI gateway
 */

const API_BASE = '';  // Vite proxy handles routing to http://localhost:8000

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUsers() {
  const res = await fetch(`${API_BASE}/api/users/`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  return res.json();
}

export async function createUser(name, email, role) {
  const res = await fetch(`${API_BASE}/api/users/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: email || null, role: role || 'caregiver' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to create user: ${res.status}`);
  }
  return res.json();
}

export async function deleteUser(userId) {
  const res = await fetch(`${API_BASE}/api/users/${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete user: ${res.status}`);
  return res.ok;
}

// ─── Training ─────────────────────────────────────────────────────────────────

export async function trainModel(modelType, epochs, batchSize = 32) {
  const res = await fetch(`${API_BASE}/api/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_type: modelType, epochs, batch_size: batchSize }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Training failed: ${res.status}`);
  }
  return res.json();
}

// ─── Health / Stats ──────────────────────────────────────────────────────────

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  if (!res.ok) throw new Error(`Stats fetch failed: ${res.status}`);
  return res.json();
}

// ─── Report ──────────────────────────────────────────────────────────────────

export async function downloadReportPdf() {
  const res = await fetch(`${API_BASE}/api/report/pdf`);
  if (!res.ok) throw new Error(`Report request failed (${res.status})`);
  return res.blob();
}

// ─── WebSocket URLs ──────────────────────────────────────────────────────────

export function getWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/stream`;
}

export function getIpWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/ip-stream`;
}
