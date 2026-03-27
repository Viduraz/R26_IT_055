"""
gateway-dashboard/backend/app/schemas/gateway_schema.py
"""
from pydantic import BaseModel
from typing import Dict


class ServiceStatus(BaseModel):
    services: Dict[str, str]
