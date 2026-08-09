import os
import sys
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from app.ml_services.models.lstm_model import _build_model, LSTM_WEIGHTS_PATH

# Configuration
INPUT_SIZE = 48
SEQ_LEN = 30
NUM_CLASSES = 4
BATCH_SIZE = 64
EPOCHS = 35
LR = 0.001

# Feature vector index shortcuts (matching feature_engineer & rule_engine)
_IDX_TORSO_ANGLE = 8     # normalized by /90
_IDX_BODY_CY = 12        # body_cy in features (index 12)
_IDX_HEAD_HEIGHT = 13    # head_height in features (index 13)
_IDX_ASPECT_RATIO = 14   # normalized by /3
_IDX_BODY_VELOCITY = 18
_IDX_WRIST_L_VEL = 19
_IDX_WRIST_R_VEL = 20
_IDX_HEAD_DROP = 21
_IDX_POSE_ENERGY = 22
_IDX_AVG_WRIST_VEL = 47

def generate_synthetic_data(num_samples=2000):
    """
    Generate synthetic sequence data of shape (num_samples, SEQ_LEN, INPUT_SIZE)
    and class labels of shape (num_samples,).
    
    Classes:
    0 = normal_activity
    1 = fall_detected
    2 = aggression_detected
    3 = prolonged_inactivity
    """
    np.random.seed(42)
    samples_per_class = num_samples // NUM_CLASSES
    X = []
    y = []

    for label in range(NUM_CLASSES):
        for _ in range(samples_per_class):
            seq = np.random.normal(0, 0.05, (SEQ_LEN, INPUT_SIZE)) # baseline noise
            
            # Base joints values (elbow, shoulder, knee, hip angles around 90-140 deg)
            seq[:, 0:8] = np.random.uniform(0.5, 0.8, (SEQ_LEN, 8))
            
            # Base visibility scores
            seq[:, 15:18] = np.random.uniform(0.8, 1.0, (SEQ_LEN, 3))
            
            # Base positions (around centre of screen)
            seq[:, 11] = np.random.uniform(0.45, 0.55, SEQ_LEN) # body_cx
            
            if label == 0: # normal_activity
                # Torso angle is low (upright)
                seq[:, _IDX_TORSO_ANGLE] = np.random.uniform(0.05, 0.2, SEQ_LEN) # < 18 deg
                # Body center-of-mass is high
                seq[:, _IDX_BODY_CY] = np.random.uniform(0.35, 0.5, SEQ_LEN)
                seq[:, _IDX_HEAD_HEIGHT] = np.random.uniform(0.3, 0.4, SEQ_LEN)
                # Aspect ratio is normal/standing
                seq[:, _IDX_ASPECT_RATIO] = np.random.uniform(0.5, 0.8, SEQ_LEN) # 1.5 - 2.4
                # Slow movements
                seq[:, _IDX_BODY_VELOCITY] = np.random.uniform(0.001, 0.01, SEQ_LEN)
                seq[:, _IDX_WRIST_L_VEL] = np.random.uniform(0.002, 0.015, SEQ_LEN)
                seq[:, _IDX_WRIST_R_VEL] = np.random.uniform(0.002, 0.015, SEQ_LEN)
                seq[:, _IDX_POSE_ENERGY] = np.random.uniform(0.002, 0.01, SEQ_LEN)
                
            elif label == 1: # fall_detected
                # Starts standing, falls halfway through sequence (frame 15)
                fall_start = 15
                
                # Upright portion
                seq[:fall_start, _IDX_TORSO_ANGLE] = np.random.uniform(0.05, 0.2, fall_start)
                seq[:fall_start, _IDX_BODY_CY] = np.random.uniform(0.35, 0.5, fall_start)
                seq[:fall_start, _IDX_HEAD_HEIGHT] = np.random.uniform(0.3, 0.4, fall_start)
                seq[:fall_start, _IDX_ASPECT_RATIO] = np.random.uniform(0.5, 0.8, fall_start)
                seq[:fall_start, _IDX_BODY_VELOCITY] = np.random.uniform(0.001, 0.01, fall_start)
                seq[:fall_start, _IDX_WRIST_L_VEL] = np.random.uniform(0.002, 0.015, fall_start)
                seq[:fall_start, _IDX_WRIST_R_VEL] = np.random.uniform(0.002, 0.015, fall_start)
                
                # Fall progression
                for t in range(fall_start, SEQ_LEN):
                    pct = (t - fall_start) / (SEQ_LEN - fall_start) # 0 to 1
                    # Torso tips over horizontally (angle increases to > 70 deg)
                    seq[t, _IDX_TORSO_ANGLE] = 0.2 + pct * 0.7 # up to ~80 deg
                    # Body center-of-mass drops low
                    seq[t, _IDX_BODY_CY] = 0.4 + pct * 0.45 # down to 0.85
                    seq[t, _IDX_HEAD_HEIGHT] = 0.3 - pct * 0.25 # head drops close to hips
                    # Aspect ratio becomes wide (horizontal layout)
                    seq[t, _IDX_ASPECT_RATIO] = 0.6 - pct * 0.45 # down to 0.15
                    # High downward velocity and energy during the impact
                    seq[t, _IDX_BODY_VELOCITY] = 0.03 * (1 - pct) # velocity spikes and then fades
                    seq[t, _IDX_HEAD_DROP] = 0.04 * (1 - pct) # rapid drop velocity
                    seq[t, _IDX_POSE_ENERGY] = 0.05 * (1 - pct)
                    
            elif label == 2: # aggression_detected
                # High torso and arm activity throughout
                seq[:, _IDX_TORSO_ANGLE] = np.random.uniform(0.1, 0.4, SEQ_LEN) # leaning/shaking
                seq[:, _IDX_BODY_CY] = np.random.uniform(0.35, 0.5, SEQ_LEN)
                # Spiking high velocities on wrists and energy
                seq[:, _IDX_BODY_VELOCITY] = np.random.uniform(0.005, 0.025, SEQ_LEN)
                seq[:, _IDX_WRIST_L_VEL] = np.random.uniform(0.03, 0.12, SEQ_LEN)
                seq[:, _IDX_WRIST_R_VEL] = np.random.uniform(0.03, 0.12, SEQ_LEN)
                seq[:, _IDX_POSE_ENERGY] = np.random.uniform(0.03, 0.09, SEQ_LEN)
                seq[:, _IDX_ASPECT_RATIO] = np.random.uniform(0.4, 0.7, SEQ_LEN)
                seq[:, _IDX_AVG_WRIST_VEL] = np.random.uniform(0.05, 0.15, SEQ_LEN) # High jerk / avg vel
                
            elif label == 3: # prolonged_inactivity
                # Stable but close to zero velocity and energy
                seq[:, _IDX_TORSO_ANGLE] = np.random.uniform(0.05, 0.15, SEQ_LEN)
                seq[:, _IDX_BODY_CY] = np.random.uniform(0.35, 0.45, SEQ_LEN) # sitting/standing still
                seq[:, _IDX_HEAD_HEIGHT] = np.random.uniform(0.3, 0.38, SEQ_LEN)
                seq[:, _IDX_ASPECT_RATIO] = np.random.uniform(0.5, 0.8, SEQ_LEN)
                # Zero velocities
                seq[:, _IDX_BODY_VELOCITY] = np.random.uniform(0.0, 0.001, SEQ_LEN)
                seq[:, _IDX_WRIST_L_VEL] = np.random.uniform(0.0, 0.001, SEQ_LEN)
                seq[:, _IDX_WRIST_R_VEL] = np.random.uniform(0.0, 0.001, SEQ_LEN)
                seq[:, _IDX_HEAD_DROP] = np.random.uniform(-0.001, 0.001, SEQ_LEN)
                seq[:, _IDX_POSE_ENERGY] = np.random.uniform(0.0, 0.002, SEQ_LEN)
                
            X.append(seq)
            y.append(label)
            
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int64)

def main():
    print("Generating synthetic sequence data...")
    X, y = generate_synthetic_data()
    print(f"Generated X: {X.shape}, y: {y.shape}")

    # Convert to tensors
    X_t = torch.tensor(X)
    y_t = torch.tensor(y)

    dataset = TensorDataset(X_t, y_t)
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

    print("Building LSTM Classifier model...")
    model = _build_model()
    
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=LR)

    print("Training LSTM Classifier...")
    model.train()
    for epoch in range(EPOCHS):
        running_loss = 0.0
        correct = 0
        total = 0
        for inputs, labels in dataloader:
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            
            running_loss += loss.item() * inputs.size(0)
            _, predicted = torch.max(outputs, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
        epoch_loss = running_loss / len(dataset)
        accuracy = correct / total
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"Epoch {epoch+1:02d}/{EPOCHS:02d} | Loss: {epoch_loss:.4f} | Accuracy: {accuracy*100:.2f}%")

    # Save trained weights
    os.makedirs(os.path.dirname(LSTM_WEIGHTS_PATH), exist_ok=True)
    torch.save(model.state_dict(), LSTM_WEIGHTS_PATH)
    print(f"[SUCCESS] LSTM weights successfully saved to {LSTM_WEIGHTS_PATH}")

if __name__ == "__main__":
    main()
