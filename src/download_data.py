import os
import urllib.request
import zipfile

RAW_DATA_DIR = "data/raw_mmash"
ZIP_URL = "https://physionet.org/static/published-projects/mmash/multilevel-monitoring-of-activity-and-sleep-in-healthy-people-1.0.0.zip"
ZIP_PATH = os.path.join(RAW_DATA_DIR, "mmash.zip")

def download_mmash():
    os.makedirs(RAW_DATA_DIR, exist_ok=True)
    
    if not os.path.exists(ZIP_PATH):
        print(f"Downloading MMASH dataset from PhysioNet...")
        urllib.request.urlretrieve(ZIP_URL, ZIP_PATH)
        print("Download complete.")
    else:
        print("Zip file already exists, skipping download.")
        
    print("Extracting files...")
    with zipfile.ZipFile(ZIP_PATH, 'r') as zip_ref:
        zip_ref.extractall(RAW_DATA_DIR)
    print("Extraction complete. MMASH dataset ready.")

if __name__ == "__main__":
    download_mmash()
