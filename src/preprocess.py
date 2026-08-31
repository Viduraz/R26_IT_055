import os
import pandas as pd
import numpy as np

RAW_DATA_DIR = 'data/raw_mmash'
PROCESSED_DATA_DIR = 'data/processed'


def extract_window_features(window):
    ax, ay, az = window[:, 0], window[:, 1], window[:, 2]
    vm = np.sqrt(ax**2 + ay**2 + az**2)
    
    features = [
        ax.mean(), ax.std(), ax.min(), ax.max(),
        ay.mean(), ay.std(), ay.min(), ay.max(),
        az.mean(), az.std(), az.min(), az.max(),
        vm.mean(), vm.std(), vm.min(), vm.max(),
        np.sum(ax**2), np.sum(ay**2), np.sum(az**2), np.sum(vm**2)
    ]
    return features

def prepare_mmash_dataset(data_dir='data/raw_mmash', window_size=60, step_size=15):
    X, y = [], []
    user_dirs = [d for d in os.listdir(data_dir) if d.startswith('user_')]
    print(f'Found {len(user_dirs)} user records.')
    
    for user in user_dirs:
        act_path = os.path.join(data_dir, user, 'Actigraph.csv')
        activity_path = os.path.join(data_dir, user, 'Activity.csv')
        
        if not os.path.exists(act_path) or not os.path.exists(activity_path):
            continue
            
        act_df = pd.read_csv(act_path)
        activity_df = pd.read_csv(activity_path)
        
        # Standardize column casing
        act_df.columns = [c.capitalize() if c.lower() in ['axis1', 'axis2', 'axis3'] else c for c in act_df.columns]
        data_columns = ['Axis1', 'Axis2', 'Axis3']
        
        for _, row in activity_df.iterrows():
            act_id = row['Activity']
            start_t, end_t = row['Start'], row['End']
            
            # Filter actigraph data for activity duration
            sub_df = act_df[(act_df['time'] >= start_t) & (act_df['time'] <= end_t)]
            
            if len(sub_df) < window_size:
                continue
                
            data_arr = sub_df[data_columns].to_numpy()

            # Sliding window segmentation using NumPy slices
            for i in range(0, len(data_arr) - window_size + 1, step_size):
                win = data_arr[i:i + window_size]
                feats = extract_window_features(win)
                X.append(feats)
                y.append(act_id)
                
    X = np.array(X)
    y = np.array(y)
    
    os.makedirs(PROCESSED_DATA_DIR, exist_ok=True)
    np.save(os.path.join(PROCESSED_DATA_DIR, 'X.npy'), X)
    np.save(os.path.join(PROCESSED_DATA_DIR, 'y.npy'), y)
    print(f'Enhanced dataset processed. Shapes -> X: {X.shape}, y: {y.shape}')

if __name__ == '__main__':
    prepare_mmash_dataset()
