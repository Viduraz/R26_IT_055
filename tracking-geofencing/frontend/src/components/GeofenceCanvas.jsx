import { useState, useRef, useEffect, useCallback } from "react";
import { geofenceApi } from "../services/trackingApi";

const ZONE_COLORS = {
  safe: "#00FF9D",
  restricted: "#FF3B5C",
  alert: "#FFB800",
};

export default function GeofenceCanvas({ backendOnline, onZoneCreated }) {
  const canvasRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [zoneType, setZoneType] = useState("restricted");
  const [zoneName, setZoneName] = useState("");
  const [zones, setZones] = useState([]);
  const [saving, setSaving] = useState(false);

  // Fetch existing zones to draw
  const fetchZones = useCallback(async () => {
    if (!backendOnline) return;
    try {
      const res = await geofenceApi.getZones();
      if (res.data && Array.isArray(res.data)) setZones(res.data);
    } catch {}
  }, [backendOnline]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  // Draw everything
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Background grid
    ctx.fillStyle = "#0A0F1E";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(0, 212, 255, 0.06)";
    ctx.lineWidth = 1;
    const gridSize = 30;
    for (let x = 0; x <= canvas.width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Draw saved zones
    zones.forEach((zone) => {
      if (!zone.polygon || zone.polygon.length < 3) return;
      const color = ZONE_COLORS[zone.zone_type] || "#00D4FF";

      ctx.beginPath();
      ctx.moveTo(zone.polygon[0][0], zone.polygon[0][1]);
      zone.polygon.forEach(([px, py], i) => {
        if (i > 0) ctx.lineTo(px, py);
      });
      ctx.closePath();

      ctx.fillStyle = color + "18";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Label
      const cx = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length;
      const cy = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length;
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(zone.name, cx, cy);
      ctx.textAlign = "start";
    });

    // Draw current polygon being drawn
    if (points.length > 0) {
      const color = ZONE_COLORS[zoneType] || "#00D4FF";
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      points.forEach(([px, py], i) => {
        if (i > 0) ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw points
      points.forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }, [points, zones, zoneType]);

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    setPoints((prev) => [...prev, [x, y]]);
  };

  const handleDoubleClick = async (e) => {
    e.preventDefault();
    if (points.length < 3) return;

    const name = zoneName.trim() || `Zone ${Date.now().toString(36).slice(-4).toUpperCase()}`;

    setSaving(true);
    try {
      await geofenceApi.createZone({
        name,
        zone_type: zoneType,
        polygon: points,
        color: ZONE_COLORS[zoneType],
      });
      setPoints([]);
      setZoneName("");
      fetchZones();
      if (onZoneCreated) onZoneCreated();
    } catch (err) {
      console.error("Failed to save zone:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setPoints([]);
    setZoneName("");
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2><span className="icon">📐</span> Geofence Canvas</h2>
        <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={points.length === 0}>
          ✕ Clear
        </button>
      </div>
      <div className="panel-body">
        <div className="geofence-canvas-wrapper">
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            style={{ width: "100%", height: "100%" }}
          />
          <div className="canvas-instructions">
            Click to add points · Double-click to save zone · {points.length} point{points.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="canvas-toolbar">
          {["safe", "restricted", "alert"].map((t) => (
            <button
              key={t}
              className={`zone-type-btn ${t} ${zoneType === t ? "active" : ""}`}
              onClick={() => setZoneType(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {points.length > 0 && (
          <div className="zone-name-input-row">
            <input
              type="text"
              placeholder="Zone name (optional)"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleDoubleClick}
              disabled={points.length < 3 || saving}
            >
              {saving ? "Saving..." : "Save Zone"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
