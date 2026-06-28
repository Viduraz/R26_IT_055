import os
import sys
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from app.ml_services.models.autoencoder_model import _build_model, AE_WEIGHTS_PATH

# Configuration
INPUT_DIM = 40
SEQ_LEN = 30
BATCH_SIZE = 64
EPOCHS = 35
LR = 0.001

# Feature indices
_IDX_TORSO_ANGLE = 8
_IDX_BODY_CY = 12
_IDX_HEAD_HEIGHT = 13
_IDX_ASPECT_RATIO = 14
_IDX_BODY_VELOCITY = 18
_IDX_WRIST_L_VEL = 19
_IDX_WRIST_R_VEL = 20
_IDX_POSE_ENERGY = 22

def generate_normal_data(num_samples=1500):
    """
    Generate synthetic sequence data representing ONLY normal activities.
    Returns:
        X: shape (num_samples, SEQ_LEN * INPUT_DIM)
    """
    np.random.seed(100)
    X = []
    
    for _ in range(num_samples):
        # Baseline noise
        seq = np.random.normal(0, 0.05, (SEQ_LEN, INPUT_DIM))
        
        # Base joints values (elbow, shoulder, knee, hip angles around 90-140 deg)
        seq[:, 0:8] = np.random.uniform(0.5, 0.8, (SEQ_LEN, 8))
        
        # Base visibility scores
        seq[:, 15:18] = np.random.uniform(0.8, 1.0, (SEQ_LEN, 3))
        
        # Base positions (around centre of screen)
        seq[:, 11] = np.random.uniform(0.45, 0.55, SEQ_LEN) # body_cx
        
        # Upright or sitting normally
        seq[:, _IDX_TORSO_ANGLE] = np.random.uniform(0.05, 0.2, SEQ_LEN) # torso upright
        seq[:, _IDX_BODY_CY] = np.random.uniform(0.35, 0.5, SEQ_LEN)
        seq[:, _IDX_HEAD_HEIGHT] = np.random.uniform(0.3, 0.4, SEQ_LEN)
        seq[:, _IDX_ASPECT_RATIO] = np.random.uniform(0.5, 0.8, SEQ_LEN) # standing/sitting height
        
        # Low/slow velocities (normal movement)
        seq[:, _IDX_BODY_VELOCITY] = np.random.uniform(0.001, 0.01, SEQ_LEN)
        seq[:, _IDX_WRIST_L_VEL] = np.random.uniform(0.002, 0.015, SEQ_LEN)
        seq[:, _IDX_WRIST_R_VEL] = np.random.uniform(0.002, 0.015, SEQ_LEN)
        seq[:, _IDX_POSE_ENERGY] = np.random.uniform(0.002, 0.01, SEQ_LEN)
        
        # Append flattened sequence (1200 values)
        X.append(seq.flatten())
        
    return np.array(X, dtype=np.float32)

def main():
    print("Generating synthetic normal sequence data for Autoencoder...")
    X = generate_normal_data()
    print(f"Generated X: {X.shape}")

    X_t = torch.tensor(X)
    dataset = TensorDataset(X_t)
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

    print("Building Pose Autoencoder model...")
    model = _build_model()
    
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=LR)

    print("Training Pose Autoencoder...")
    model.train()
    for epoch in range(EPOCHS):
        running_loss = 0.0
        for batch in dataloader:
            inputs = batch[0]
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, inputs)
            loss.backward()
            optimizer.step()
            
            running_loss += loss.item() * inputs.size(0)
            
        epoch_loss = running_loss / len(dataset)
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"Epoch {epoch+1:02d}/{EPOCHS:02d} | Reconstruction MSE Loss: {epoch_loss:.6f}")

    # Save trained weights
    os.makedirs(os.path.dirname(AE_WEIGHTS_PATH), exist_ok=True)
    torch.save(model.state_dict(), AE_WEIGHTS_PATH)
    print(f"[SUCCESS] Autoencoder weights successfully saved to {AE_WEIGHTS_PATH}")

if __name__ == "__main__":
    main()
