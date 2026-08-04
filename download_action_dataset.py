import kagglehub

print('Downloading Human Action Recognition Video dataset...')
dataset_path = kagglehub.dataset_download('ngoduy/dataset-video-for-human-action-recognition')
print('Dataset path:', dataset_path)
