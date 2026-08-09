import { useState, useEffect, useRef } from "react";
import { trackingApi } from "../services/trackingApi";

export default function StatsBar({ backendOnline }) {
  const [stats, setStats] = useState({
    total_tracked_today: 0,
    active_now: 0,
    alerts_today: 0,
    zones_configured: 0,
    total_unique_persons: 0,
  });
  const intervalRef = useRef(null);
  const [animated, setAnimated] = useState({
    total_tracked_today: 0,
    active_now: 0,
    alerts_today: 0,
    zones_configured: 0,
    total_unique_persons: 0,
  });

  useEffect(() => {
    if (!backendOnline) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Reset active to 0 when offline
      setStats((prev) => ({ ...prev, active_now: 0 }));
      return;
    }

    const fetchStats = async () => {
      try {
        const res = await trackingApi.getStats();
        if (res.data) setStats(res.data);
      } catch { }
    };

    fetchStats();
    intervalRef.current = setInterval(fetchStats, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [backendOnline]);

  // Animate counters
  useEffect(() => {
    const keys = Object.keys(animated);
    const duration = 400;
    const startTime = Date.now();
    const startValues = { ...animated };

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      const next = {};
      keys.forEach((k) => {
        const sv = startValues[k] || 0;
        const tv = stats[k] || 0;
        next[k] = Math.round(sv + (tv - sv) * eased);
      });
      setAnimated(next);

      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [stats]);

  const cards = [
    { key: "active_now", label: "Active Now", color: "cyan", icon: "👁️", showPulse: true },
    { key: "alerts_today", label: "Alerts Today", color: "danger", icon: "🚨" },
    { key: "zones_configured", label: "Zones", color: "warning", icon: "📍" },
  ];

  return (
    <div className="stats-bar">
      {cards.map((c) => (
        <div key={c.key} className={`stat-card ${c.color}`}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value">
            {animated[c.key] || 0}
            {c.showPulse && (animated[c.key] || 0) > 0 && (
              <span className="active-pulse-dot" />
            )}
          </div>
          <span className="stat-icon">{c.icon}</span>
        </div>
      ))}
    </div>
  );
}
