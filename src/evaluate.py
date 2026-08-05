import os
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import train_test_split

def evaluate():
    # Load data and model
    X = np.load('data/processed/X.npy') if os.path.exists('data/processed/X.npy') else pd.read_csv('data/processed/X.csv')
    y = np.load('data/processed/y.npy') if os.path.exists('data/processed/y.npy') else pd.read_csv('data/processed/y.csv')
    if hasattr(y, 'values'):
        y = y.values.ravel()

    _, X_test, _, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    model = joblib.load('src/models/mmash_rf_model.pkl')
    y_pred = model.predict(X_test)

    # Plot Confusion Matrix
    cm = confusion_matrix(y_test, y_pred)
    plt.figure(figsize=(10, 8))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues')
    plt.title('MMASH Activity Classification - Confusion Matrix')
    plt.xlabel('Predicted Label')
    plt.ylabel('True Label')
    
    os.makedirs('reports/figures', exist_ok=True)
    plt.savefig('reports/figures/confusion_matrix.png', bbox_inches='tight')
    plt.close()
    print("Saved confusion matrix to reports/figures/confusion_matrix.png")

if __name__ == '__main__':
    evaluate()
