cat << 'EOF' > download_action_dataset.py
import kagglehub

print("Downloading Human Action Recognition Video dataset (~150 MB)...")
dataset_path = kagglehub.dataset_download("ngoduy/dataset-video-for-human-action-recognition")
print("Dataset successfully downloaded to path:", dataset_path)
EOF