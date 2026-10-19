"""Safety checks for uncertain activity detections."""

import sys
import unittest


sys.modules["shared"] = type("MockShared", (), {})()
sys.modules["shared.backend"] = type("MockSharedBackend", (), {})()
sys.modules["shared.backend.config"] = type("MockConfig", (), {})()
sys.modules["shared.backend.config.database"] = type(
    "MockDatabase",
    (),
    {"get_db": staticmethod(lambda: {})},
)()

from app.services.monitoring_service import MonitoringService


class MonitoringSafetyTests(unittest.TestCase):
    def test_unknown_detection_does_not_log(self):
        result = MonitoringService().process_detection_event(
            {
                "patient_id": "patient_001",
                "detected_activity": "Unknown",
                "confidence": 0.9,
            }
        )

        self.assertFalse(result["logged"])
        self.assertEqual(result["status"], "unknown")

    def test_low_confidence_detection_does_not_log(self):
        result = MonitoringService().process_detection_event(
            {
                "patient_id": "patient_001",
                "detected_activity": "Walking",
                "confidence": 0.64,
            }
        )

        self.assertFalse(result["logged"])
        self.assertEqual(result["status"], "unknown")


if __name__ == "__main__":
    unittest.main()
