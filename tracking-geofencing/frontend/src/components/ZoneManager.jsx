import { useState, useEffect, useCallback } from "react";
import { geofenceApi } from "../services/trackingApi";

export default function ZoneManager({ backendOnline, refreshKey, onZonesChanged }) {
  const [zones, setZones] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchZones = useCallback(async () => {
    if (!backendOnline) return;
    try {
      const res = await geofenceApi.getZones();
      if (res.data && Array.isArray(res.data)) setZones(res.data);
    } catch {}
  }, [backendOnline]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones, refreshKey]);

  const handleToggle = async (zone) => {
    try {
      await geofenceApi.updateZone(zone.zone_id, { is_active: !zone.is_active });
      setZones((prev) =>
        prev.map((z) =>
          z.zone_id === zone.zone_id ? { ...z, is_active: !z.is_active } : z
        )
      );
      if (onZonesChanged) onZonesChanged();
    } catch {}
  };

  const handleDelete = async (zoneId) => {
    try {
      await geofenceApi.deleteZone(zoneId);
      setZones((prev) => prev.filter((z) => z.zone_id !== zoneId));
      setDeleteConfirm(null);
      if (onZonesChanged) onZonesChanged();
    } catch {}
  };

  const formatDate = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return ts; }
  };

  return (
    <div className="panel zone-manager">
      <div className="panel-header">
        <h2><span className="icon">🗺️</span> Zone Manager</h2>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {zones.length} zone{zones.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="panel-body">
        <div className="zone-list">
          {zones.length === 0 ? (
            <div className="zone-empty">
              <p>No zones configured. Draw one on the canvas above.</p>
            </div>
          ) : (
            zones.map((zone) => (
              <div key={zone.zone_id} className="zone-card" style={{ opacity: zone.is_active ? 1 : 0.5 }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span className="zone-color-dot" style={{ background: zone.color || "#00D4FF" }} />
                  <span className="zone-name">{zone.name}</span>
                </div>
                <span className={`zone-type-badge ${zone.zone_type}`}>
                  {zone.zone_type}
                </span>
                <div className="zone-meta">
                  {zone.polygon?.length || 0} points · {formatDate(zone.created_at)}
                  {zone.zone_type === "restricted" && zone.camera_distance !== undefined && (
                    <> · 📏 {zone.camera_distance.toFixed(1)}m depth</>
                  )}
                </div>
                <div className="zone-actions">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={zone.is_active}
                      onChange={() => handleToggle(zone)}
                    />
                    <span className="toggle-slider" />
                  </label>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setDeleteConfirm(zone.zone_id)}
                    style={{ marginLeft: "auto" }}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Zone?</h3>
            <p>This will permanently remove the geofence zone and cannot be undone.</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
