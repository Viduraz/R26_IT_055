"""
schedule-monitoring/backend/app/services/activity_service.py

Random Forest Activity Detection Service

Loads a pre-trained Random Forest model and provides activity prediction
from pose features extracted by the frontend.

Model files:
  - app/models/rf_model.pkl      → Trained Random Forest classifier
  - app/models/rf_model_stats.json → Normalization stats (mean, std)
"""

import numpy as np
import joblib
import json
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

ACTIVITY_NAMES = [
    'Walking',
    'Sitting / rest',
    'Sleeping',
    'Eating',
    'Drinking'
]

class ActivityService:
    """Random Forest activity detection service"""
    
    def __init__(self):
        """Initialize the service and load model"""
        self.model = None
        self.norm_mean = None
        self.norm_std = None
        self.is_ready = False
        self.model_path = Path(__file__).parent.parent / 'models' / 'rf_model.pkl'
        self.stats_path = Path(__file__).parent.parent / 'models' / 'rf_model_stats.json'
        
        self._load_model()
    
    def _load_model(self) -> bool:
        """Load the Random Forest model and normalization stats"""
        try:
            if not self.model_path.exists():
                logger.warning(f"Model not found at {self.model_path}")
                return False
            
            # Load model
            self.model = joblib.load(self.model_path)
            logger.info(f"✓ Loaded RF model from {self.model_path}")
            
            # Load stats
            if self.stats_path.exists():
                with open(self.stats_path, 'r') as f:
                    stats = json.load(f)
                self.norm_mean = np.array(stats['mean'], dtype=np.float32)
                self.norm_std = np.array(stats['std'], dtype=np.float32)
                logger.info(f"✓ Loaded normalization stats from {self.stats_path}")
            else:
                logger.warning(f"Stats file not found at {self.stats_path}")
                # Use default stats (no normalization)
                self.norm_mean = np.zeros(15, dtype=np.float32)
                self.norm_std = np.ones(15, dtype=np.float32)
            
            self.is_ready = True
            return True
        
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            self.is_ready = False
            return False
    
    def is_model_loaded(self) -> bool:
        """Check if model is ready for predictions"""
        return self.is_ready and self.model is not None
    
    def predict_activity(self, features: List[float]) -> Tuple[str, float]:
        """
        Predict activity from 15 pose features.
        
        Args:
            features: List of 15 float values (pose features)
        
        Returns:
            (activity_name: str, confidence: float)
            confidence is the proportion of voting trees that predicted this class
        
        Raises:
            ValueError: If model not ready or invalid features
        """
        if not self.is_model_loaded():
            raise ValueError("Model not loaded. Ensure rf_model.pkl is in app/models/")
        
        if len(features) != 15:
            raise ValueError(f"Expected 15 features, got {len(features)}")
        
        try:
            # Convert to numpy array
            X = np.array([features], dtype=np.float32)
            
            # Normalize features
            X_norm = (X - self.norm_mean) / (self.norm_std + 1e-8)
            
            # Predict
            activity_idx = self.model.predict(X_norm)[0]
            
            # Get confidence from the voting trees
            # Each tree in the forest votes, confidence = proportion that voted for predicted class
            tree_predictions = np.array([tree.predict(X_norm)[0] for tree in self.model.estimators_])
            confidence = np.sum(tree_predictions == activity_idx) / len(self.model.estimators_)
            
            activity_name = ACTIVITY_NAMES[activity_idx]
            
            return activity_name, float(confidence)
        
        except Exception as e:
            logger.error(f"Prediction error: {e}")
            raise ValueError(f"Prediction failed: {e}")
    
    def predict_batch(self, features_list: List[List[float]]) -> List[Tuple[str, float]]:
        """
        Predict activities for multiple feature sets.
        
        Args:
            features_list: List of feature vectors (each with 15 features)
        
        Returns:
            List of (activity_name, confidence) tuples
        """
        if not self.is_model_loaded():
            raise ValueError("Model not loaded")
        
        results = []
        for features in features_list:
            activity, confidence = self.predict_activity(features)
            results.append((activity, confidence))
        
        return results

# Global service instance
_activity_service: Optional[ActivityService] = None

def get_activity_service() -> ActivityService:
    """Get or create the global activity service instance"""
    global _activity_service
    if _activity_service is None:
        _activity_service = ActivityService()
    return _activity_service
