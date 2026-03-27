"""
gateway-dashboard/backend/app/controllers/gateway_controller.py
"""
from app.services.dashboard_service import DashboardService
from app.services.alert_aggregator_service import AlertAggregatorService

_dash = DashboardService()
_alerts = AlertAggregatorService()


async def get_system_overview(user: dict):
    return await _dash.get_overview()


async def get_alerts(user: dict):
    return await _alerts.aggregate_alerts()
