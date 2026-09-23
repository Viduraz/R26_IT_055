import argparse
import shutil
from pathlib import Path

import kagglehub

DEFAULT_SLUG = "mdmofazzalhossain789/kard-kinect-activity-recognition-dataset"
DEFAULT_DEST = Path("data") / "kard-kinect-activity-recognition-dataset"


def download_dataset(slug: str = DEFAULT_SLUG, dest_dir: Path = DEFAULT_DEST) -> Path:
    """Download a public Kaggle dataset into the repo-local data folder."""
    dest_dir.mkdir(parents=True, exist_ok=True)

    print(f"[download] Downloading Kaggle dataset: {slug}")
    dataset_path = kagglehub.dataset_download(slug)
    source_dir = Path(dataset_path)
    print(f"[download] Source dataset path: {source_dir}")

    if not source_dir.exists():
        raise FileNotFoundError(f"Dataset was not created at {source_dir}")

    # copy the downloaded files into a repo-local folder so the project can use them reliably
    for child in source_dir.iterdir():
        target = dest_dir / child.name
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)

    print(f"[download] Dataset ready at: {dest_dir}")
    return dest_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Download the KARD Kinect Activity Recognition Dataset.")
    parser.add_argument("--slug", default=DEFAULT_SLUG, help="Kaggle dataset slug to download.")
    parser.add_argument("--dest", default=str(DEFAULT_DEST), help="Local destination directory inside the repo.")
    args = parser.parse_args()

    try:
        download_dataset(args.slug, Path(args.dest))
        return 0
    except Exception as exc:
        print(f"[error] Download failed: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
