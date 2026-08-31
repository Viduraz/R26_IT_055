import os
import joblib
import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split


def train():
    # 1. Load data
    data_path_x = (
        'data/processed/X.npy'
        if os.path.exists('data/processed/X.npy')
        else 'data/processed/X.csv'
    )
    data_path_y = (
        'data/processed/y.npy'
        if os.path.exists('data/processed/y.npy')
        else 'data/processed/y.csv'
    )

    X = (
        np.load(data_path_x)
        if data_path_x.endswith('.npy')
        else pd.read_csv(data_path_x)
    )
    y = (
        np.load(data_path_y)
        if data_path_y.endswith('.npy')
        else pd.read_csv(data_path_y)
    )

    if hasattr(y, 'values'):
        y = y.values.ravel()

    # 2. Train/Test Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # 3. Apply SMOTE to training data only
    print('Applying SMOTE resampling on training set...')
    smote = SMOTE(random_state=42)
    X_train_res, y_train_res = smote.fit_resample(X_train, y_train)
    print(f'Original training shape: {X_train.shape}')
    print(f'Resampled training shape: {X_train_res.shape}')

    # 4. Train Model
    print('\nTraining Random Forest Classifier on resampled dataset...')
    rf = RandomForestClassifier(
        n_estimators=100, random_state=42, n_jobs=-1
    )
    rf.fit(X_train_res, y_train_res)

    # 5. Evaluate Model
    y_pred = rf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print(f'\nModel Test Accuracy: {acc * 100:.2f}%\n')
    print('Classification Report:')
    print(classification_report(y_test, y_pred))

    # 6. Save Artifact
    os.makedirs('src/models', exist_ok=True)
    joblib.dump(rf, 'src/models/mmash_rf_model.pkl')
    print('Model saved to src/models/mmash_rf_model.pkl')


if __name__ == '__main__':
    train()
