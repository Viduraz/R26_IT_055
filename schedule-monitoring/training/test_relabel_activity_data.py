"""Tests for posture/action relabeling."""

import unittest

from relabel_activity_data import infer_posture, relabel_frame


class RelabelActivityDataTests(unittest.TestCase):
    def test_eating_preserves_action_and_infers_upright_posture(self):
        frame = {
            "activity": "Eating",
            "features": [0, 165, 168, 0, 0, 0.8, 0, 0, 0.02, 0, 0.5, 0, 0, 0, 0],
        }
        result = relabel_frame(frame)
        self.assertEqual(result["action"], "Eating")
        self.assertEqual(result["posture"], "Standing")

    def test_drinking_can_be_labeled_as_sitting(self):
        frame = {
            "activity": "Drinking",
            "features": [0, 90, 95, 0, 0, 0.45, 0, 0, 0.02, 0, 0.4, 0, 0, 0, 0],
        }
        result = relabel_frame(frame)
        self.assertEqual(result["action"], "Drinking")
        self.assertEqual(result["posture"], "Sitting")

    def test_sleeping_action_can_be_combined_with_legacy_sleeping_label(self):
        frame = {
            "activity": "Sleeping",
            "features": [0] * 15,
        }
        result = relabel_frame(frame)
        self.assertEqual(result["posture"], "Sleeping")
        self.assertEqual(result["action"], "None")

    def test_posture_inference_requires_features(self):
        posture, confidence, reason = infer_posture({}, "Eating")
        self.assertEqual(posture, "Unknown")
        self.assertEqual(confidence, 0.0)
        self.assertEqual(reason, "missing_features")


if __name__ == "__main__":
    unittest.main()
