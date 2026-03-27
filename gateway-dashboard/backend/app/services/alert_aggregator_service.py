"""
gateway-dashboard/backend/app/services/alert_aggregator_service.py
Pulls alerts from all module MongoDB collections and merges them.
"""
from shared.backend.config.database import get_db
from datetime import datetime


class AlertAggregatorService:
    async def aggregate_alerts(self) -> list:
        """
        Collect the latest 20 alerts from each module and merge, sorted by timestamp.
        TODO: filter by severity, user, date range.
        """
        db = get_db()
        collections = {
            "face_alerts": "face-verification",
            "tracking_alerts": "tracking-geofencing",
            "anomaly_logs": "anomaly-detection",
            "deviations": "schedule-monitoring",
        }
        all_alerts = []
        for col_name, source in collections.items():
            docs = list(db[col_name].find({}, {"_id": 0}).sort("timestamp", -1).limit(20))
            for doc in docs:
                doc["source"] = source
                doc.setdefault("timestamp", datetime.utcnow())
            all_alerts.extend(docs)

        all_alerts.sort(key=lambda d: d.get("timestamp", datetime.min), reverse=True)
        return all_alerts[:50]
