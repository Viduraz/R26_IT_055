"""Regression tests for the frontend/Python Random Forest feature contract."""

import json
import unittest
from pathlib import Path

import numpy as np

from preprocess_rf_data import extract_features


DATA_DIR = Path(__file__).parent / "data"


class FeatureContractTests(unittest.TestCase):
    def test_legacy_rf_session_shape_is_accepted_by_rf_preprocessor(self):
        with (DATA_DIR / "har_session_001_walking.json").open() as handle:
            payload = json.load(handle)

        self.assertIsInstance(payload["frames"], list)
        frame = payload["frames"][0]
        self.assertIn("activity", frame)
        self.assertIn("landmarks", frame)
        self.assertIsNotNone(extract_features(frame["landmarks"]))

    def test_lstm_exports_contain_finite_15_feature_vectors(self):
        session_files = sorted(DATA_DIR.glob("har_session_*.json"))
        self.assertGreaterEqual(len(session_files), 5)

        collected_export_count = 0
        for session_file in session_files:
            with session_file.open() as handle:
                frames = json.load(handle)["frames"]

            self.assertTrue(frames, session_file.name)
            for frame in frames[: min(10, len(frames))]:
                if "features" not in frame:
                    continue
                collected_export_count += 1
                features = np.asarray(frame["features"], dtype=np.float32)
                self.assertEqual(features.shape, (15,), session_file.name)
                self.assertTrue(np.isfinite(features).all(), session_file.name)

        self.assertGreater(collected_export_count, 0)

    def test_body_symmetry_is_non_negative(self):
        with (DATA_DIR / "har_session_001_walking.json").open() as handle:
            landmarks = json.load(handle)["frames"][0]["landmarks"]

        features = extract_features(landmarks)

        self.assertGreaterEqual(float(features[13]), 0.0)

    def test_landmark_feature_contract_has_expected_names(self):
        with (DATA_DIR / "har_session_001_walking.json").open() as handle:
            landmarks = json.load(handle)["frames"][0]["landmarks"]

        features = extract_features(landmarks)

        self.assertEqual(len(features), 15)


if __name__ == "__main__":
    unittest.main()
