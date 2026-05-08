"""
schedule-monitoring/backend/app/models/enums.py
Shared enumerations for the schedule monitoring system.
"""
from enum import Enum


class TaskType(str, Enum):
    MEAL = "meal"
    MEDICATION = "medication"
    SLEEP = "sleep"
    REST = "rest"
    EXERCISE = "exercise"
    HYDRATION = "hydration"
    CAREGIVER_ASSISTED = "caregiver_assisted"
    OTHER = "other"


class TaskStatus(str, Enum):
    DONE = "done"
    LATE = "late"
    MISSED = "missed"
    CAREGIVER_MISSING = "caregiver_missing"
    REQUIRES_REVIEW = "requires_review"
    PENDING = "pending"


class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
