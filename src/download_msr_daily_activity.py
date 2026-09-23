import os
import sys
import urllib.request
import zipfile
from pathlib import Path

RAW_DATA_DIR = Path("data") / "msr_daily_activity3d"
ZIP_NAME = "MSRDailyActivity3D.zip"
ZIP_PATH = RAW_DATA_DIR / ZIP_NAME

HISTORICAL_URLS = [
    "https://www.uow.edu.au/~wanqing/ActionRecogDataSet/MSRDailyActivity3D.zip",
    "https://documents.uow.edu.au/~wanqing/ActionRecogDataSet/MSRDailyActivity3D.zip",
    "https://documents.uow.edu.au/~wanqing/actionrecogdataset/MSRDailyActivity3D.zip",
    "https://documents.uow.edu.au/~wanqing/actionrecogdataset/msrdailyactivity3d.zip",
    "https://www.uow.edu.au/~wanqing/ActionRecogDataSet/msrdailyactivity3d.zip",
    "https://www.uow.edu.au/~wanqing/ActionRecogDataSet/MSRDailyActivity3D.rar",
    "https://documents.uow.edu.au/~wanqing/ActionRecogDataSet/MSRDailyActivity3D.rar",
]


def try_download(url: str) -> bool:
    """Attempt a single download and return True on success."""
    try:
        print(f"[download] Trying: {url}")
        with urllib.request.urlopen(url, timeout=30) as response, open(ZIP_PATH, "wb") as out:
            while True:
                chunk = response.read(1024 * 64)
                if not chunk:
                    break
                out.write(chunk)
        print(f"[download] Saved to: {ZIP_PATH}")
        return True
    except Exception as exc:
        print(f"[download] Failed for {url}: {type(exc).__name__}: {exc}")
        if ZIP_PATH.exists():
            ZIP_PATH.unlink()
        return False


def extract_dataset() -> bool:
    if not ZIP_PATH.exists():
        return False

    print(f"[extract] Extracting {ZIP_PATH}...")
    with zipfile.ZipFile(ZIP_PATH, "r") as zip_ref:
        zip_ref.extractall(RAW_DATA_DIR)

    extracted_dirs = [p for p in RAW_DATA_DIR.iterdir() if p.is_dir()]
    if not extracted_dirs:
        print("[extract] No extracted directories found; the archive may be a single-file bundle or a different format.")

    print(f"[extract] Extraction complete. Files are in: {RAW_DATA_DIR}")
    return True


def main() -> int:
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if ZIP_PATH.exists():
        print(f"[info] Found existing archive: {ZIP_PATH}")
    else:
        downloaded = False
        for url in HISTORICAL_URLS:
            if try_download(url):
                downloaded = True
                break
        if not downloaded:
            print("\n[warning] No historical MSR DailyActivity3D mirror responded successfully.")
            print("[warning] The original Microsoft/UOW links are largely retired, so the dataset may now require:")
            print("  1) a preserved mirror from a university archive or lab page,")
            print("  2) a dataset-sharing link from the original authors, or")
            print("  3) a known alternative public mirror.")
            print("\n[info] Historically, this dataset was hosted at old Microsoft/UOW URLs and may no longer be directly downloadable from the original home page.")
            print("[info] Check the original paper or author page, then place the archive in:")
            print(f"  {ZIP_PATH}")
            print("[info] After it is present, rerun this script to extract it.")
            return 1

    if not extract_dataset():
        print("[error] Dataset archive not found or extraction failed.")
        return 1

    print("\n[success] MSR DailyActivity3D is ready for use.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
