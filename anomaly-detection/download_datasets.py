"""
download_datasets.py
====================
Downloads and organises two fall-detection datasets:

  1. Le2i  – via Kaggle REST API  (tuyenldvn/falldataset-imvia)
  2. URFD  – direct HTTP from http://fenix.ur.edu.pl/mkepski/ds/data/

Target layout
-------------
datasets/
  le2i/
    falls/
    adl/
  urfd/
    falls/
    adl/
raw_downloads/          <- original zips kept here

Run from inside anomaly-detection/ or from any directory you prefer.
Requires: pip install requests
"""

import json
import os
import shutil
import sys
import zipfile
from pathlib import Path
from urllib.request import urlretrieve
from urllib.error import URLError, HTTPError

try:
    import requests
except ImportError:
    print("[!] requests not found — installing ...")
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "requests"], check=True)
    import requests

# New-style Kaggle token (KGAT_...) stored here
KAGGLE_ACCESS_TOKEN_PATH = Path.home() / ".kaggle" / "access_token"
# Legacy path
KAGGLE_JSON_PATH = Path.home() / ".kaggle" / "kaggle.json"

# ──────────────────────────────────────────────
# Paths (all relative to this script's location)
# ──────────────────────────────────────────────
BASE_DIR       = Path(__file__).parent
DATASETS_DIR   = BASE_DIR / "datasets"
RAW_DIR        = BASE_DIR / "raw_downloads"
LE2I_DIR       = DATASETS_DIR / "le2i"
URFD_DIR       = DATASETS_DIR / "urfd"

URFD_BASE_URL  = "http://fenix.ur.edu.pl/mkepski/ds/data"

# URFD has 30 fall sequences (cam0 + cam1) and 40 ADL sequences (cam0 only)
URFD_FALL_COUNT = 30
URFD_ADL_COUNT  = 40

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def make_dirs():
    for p in [
        RAW_DIR,
        LE2I_DIR / "falls",
        LE2I_DIR / "adl",
        URFD_DIR / "falls",
        URFD_DIR / "adl",
    ]:
        p.mkdir(parents=True, exist_ok=True)
    print("[OK] Directory structure created.")


def _progress(block_num, block_size, total_size):
    """Simple console progress indicator."""
    if total_size > 0:
        pct = min(100, block_num * block_size * 100 // total_size)
        bar = "#" * (pct // 5) + "-" * (20 - pct // 5)
        print(f"\r    [{bar}] {pct:3d}%", end="", flush=True)


def download_file(url: str, dest: Path, label: str = "") -> bool:
    """Download *url* to *dest*. Return True on success."""
    if dest.exists():
        print(f"  [skip] {label or dest.name} already downloaded.")
        return True
    print(f"  [DL]  {label or url}")
    try:
        urlretrieve(url, dest, reporthook=_progress)
        print()   # newline after progress bar
        return True
    except (HTTPError, URLError) as exc:
        print(f"\n  [FAIL]  FAILED - {exc}")
        if dest.exists():
            dest.unlink()          # remove partial file
        return False


def safe_extractall(zip_path: Path, extract_to: Path, label: str = "") -> bool:
    """Extract a zip safely, skipping path-traversal entries."""
    extract_to.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.namelist():
                target = (extract_to / member).resolve()
                if not str(target).startswith(str(extract_to.resolve())):
                    print(f"  [!] Skipping unsafe zip entry: {member}")
                    continue
                zf.extract(member, extract_to)
        return True
    except zipfile.BadZipFile as exc:
        print(f"  [FAIL]  Bad zip {label}: {exc}")
        return False


# ──────────────────────────────────────────────
# 1.  Le2i dataset  (Kaggle)
# ──────────────────────────────────────────────

def _get_kaggle_token() -> str:
    """
    Resolve the Kaggle API token from:
      1. KAGGLE_API_TOKEN env var
      2. ~/.kaggle/access_token  (new KGAT_ token file)
      3. ~/.kaggle/kaggle.json   (legacy — reads 'key' field)
    Raises RuntimeError if none found.
    """
    token = os.environ.get("KAGGLE_API_TOKEN", "").strip()
    if token:
        return token
    if KAGGLE_ACCESS_TOKEN_PATH.exists():
        return KAGGLE_ACCESS_TOKEN_PATH.read_text().strip()
    if KAGGLE_JSON_PATH.exists():
        creds = json.loads(KAGGLE_JSON_PATH.read_text())
        username = creds.get("username", "")
        key = creds.get("key", "")
        if username and key:
            # Legacy basic-auth — return as special sentinel
            return f"__basic__{username}:{key}"
    raise RuntimeError(
        "No Kaggle credentials found.\n"
        f"  Save your KGAT_ token to: {KAGGLE_ACCESS_TOKEN_PATH}\n"
        "  Or set KAGGLE_API_TOKEN environment variable."
    )


def check_kaggle_credentials():
    """
    Return (ok: bool, description: str) without raising.
    """
    try:
        tok = _get_kaggle_token()
        if tok.startswith("__basic__"):
            return True, "~/.kaggle/kaggle.json (legacy basic auth)"
        src = ("KAGGLE_API_TOKEN env var" if os.environ.get("KAGGLE_API_TOKEN")
               else str(KAGGLE_ACCESS_TOKEN_PATH))
        return True, src
    except RuntimeError:
        return False, str(KAGGLE_ACCESS_TOKEN_PATH)


def _kaggle_download_zip(dataset_slug: str, dest_zip: Path) -> bool:
    """
    Download a Kaggle dataset zip via the REST API.
    Works with KGAT_ bearer tokens and legacy basic auth.
    Returns True on success.
    """
    token = _get_kaggle_token()
    owner, dataset = dataset_slug.split("/", 1)
    url = f"https://www.kaggle.com/api/v1/datasets/{owner}/{dataset}/download"

    print(f"  [API] GET {url}")

    if token.startswith("__basic__"):
        _, creds = token.split("__basic__", 1)
        username, key = creds.split(":", 1)
        auth = requests.auth.HTTPBasicAuth(username, key)
        headers = {}
    else:
        auth = None
        headers = {"Authorization": f"Bearer {token}"}

    # Try primary URL first, then common alternate patterns
    urls_to_try = [
        url,
        url + f"/{dataset_slug.split('/')[-1]}.zip",   # some datasets need explicit filename
        f"https://www.kaggle.com/api/v1/datasets/{owner}/{dataset}/download/{dataset}.zip",
    ]

    for attempt_url in urls_to_try:
        try:
            with requests.get(attempt_url, headers=headers, auth=auth,
                              stream=True, allow_redirects=True, timeout=120) as r:
                if r.status_code == 404:
                    print(f"\n  [FAIL] HTTP 404 at: {attempt_url}")
                    continue  # try next URL pattern
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                downloaded = 0
                with open(dest_zip, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 1024):  # 1 MB chunks
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            pct = downloaded * 100 // total
                            bar = "#" * (pct // 5) + "-" * (20 - pct // 5)
                            print(f"\r    [{bar}] {pct:3d}%  "
                                  f"({downloaded//1024//1024}MB/{total//1024//1024}MB)",
                                  end="", flush=True)
                print()  # newline
            return True
        except requests.HTTPError as exc:
            print(f"\n  [FAIL] HTTP {exc.response.status_code}: {exc}")
            if dest_zip.exists():
                dest_zip.unlink()
        except Exception as exc:
            print(f"\n  [FAIL] {exc}")
            if dest_zip.exists():
                dest_zip.unlink()

    # All URLs failed — likely a Terms of Service gate
    print("""
  [ACTION REQUIRED] Le2i dataset returned 404 for all API URL patterns.
  This usually means Kaggle requires you to accept the dataset's Terms of
  Service before allowing programmatic downloads.

  Fix (one-time, takes 30 seconds):
    1. Go to: https://www.kaggle.com/datasets/tuyenldvn/falldataset-imvia
    2. Sign in with your Kaggle account
    3. Click the "Download" button — if a rules/terms dialog appears, accept it
    4. Once you can manually download, re-run this script

  The URFD dataset is unaffected and will continue downloading.
""")
    return False



def download_le2i() -> dict:
    """
    Download Le2i dataset from Kaggle REST API and reorganise into falls/ and adl/.
    Returns a stats dict.
    """
    print("\n" + "="*60)
    print("  Le2i Dataset  (Kaggle: tuyenldvn/falldataset-imvia)")
    print("="*60)

    dataset_slug = "tuyenldvn/falldataset-imvia"
    staging = RAW_DIR / "le2i_raw"
    staging.mkdir(parents=True, exist_ok=True)

    # kaggle API names the zip after the dataset portion of the slug
    zip_dest = RAW_DIR / "falldataset-imvia.zip"

    if not zip_dest.exists():
        print(f"[DL] Downloading {dataset_slug} via Kaggle REST API ...")
        ok = _kaggle_download_zip(dataset_slug, zip_dest)
        if not ok:
            return {"falls": 0, "adl": 0, "ambiguous": [], "errors": ["Kaggle API download failed"]}
    else:
        print(f"  [skip] {zip_dest.name} already exists in raw_downloads/")

    # Find the actual downloaded zip (kaggle naming may vary)
    candidate_zips = (
        list(RAW_DIR.glob("falldataset*.zip")) +
        list(RAW_DIR.glob("le2i*.zip")) +
        list(RAW_DIR.glob("imvia*.zip"))
    )
    if not candidate_zips:
        # Fall back: newest zip in RAW_DIR
        candidate_zips = sorted(RAW_DIR.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)

    if not candidate_zips:
        print("[FAIL] Could not find downloaded Le2i zip in raw_downloads/")
        return {"falls": 0, "adl": 0, "ambiguous": [], "errors": ["zip not found after download"]}

    le2i_zip = candidate_zips[0]
    print(f"[OK] Using zip: {le2i_zip.name}")

    # ── Extract to staging area ──────────────────────────────
    if not any(staging.iterdir()) if staging.exists() else True:
        print(f"[EXT] Extracting {le2i_zip.name} to {staging.name}/ ...")
        safe_extractall(le2i_zip, staging, le2i_zip.name)
    else:
        print(f"  [skip] Le2i already extracted to {staging.name}/")

    # ── Inspect and classify ─────────────────────────────────
    print("\n[INFO] Le2i folder structure (first 3 levels):")
    _print_tree(staging, max_depth=3)

    return _classify_le2i(staging)


def _print_tree(path: Path, prefix: str = "", max_depth: int = 3, depth: int = 0):
    if depth > max_depth or not path.is_dir():
        return
    entries = sorted(path.iterdir())
    for i, entry in enumerate(entries[:20]):
        connector = "L-- " if i == len(entries) - 1 else "|-- "
        print(f"{prefix}{connector}{entry.name}")
        if entry.is_dir() and depth < max_depth:
            extension = "    " if i == len(entries) - 1 else "|   "
            _print_tree(entry, prefix + extension, max_depth, depth + 1)
    if len(entries) > 20:
        print(f"{prefix}  ... ({len(entries) - 20} more entries)")


def _classify_le2i(staging: Path) -> dict:
    """
    Walk the Le2i extraction tree and copy videos into le2i/falls/ and le2i/adl/.

    Le2i (IMVIA) typically organises by subject + activity:
      - Directories containing 'fall' / 'chute' -> falls/
      - Everything else                          -> adl/
    Video extensions: .avi, .mp4, .mkv, .mov
    """
    VIDEO_EXT = {".avi", ".mp4", ".mkv", ".mov", ".mpeg", ".mpg"}
    FALL_KEYWORDS = {"fall", "chute", "falls", "tombee", "tombée"}
    ADL_KEYWORDS  = {"adl", "normal", "activity", "activities", "quotidienne",
                     "daily", "walking", "sitting", "standing", "lying", "bending",
                     "drinking", "eating", "marche", "debout"}

    stats = {"falls": 0, "adl": 0, "ambiguous": [], "errors": []}
    dest_falls = LE2I_DIR / "falls"
    dest_adl   = LE2I_DIR / "adl"

    def classify_path(p: Path) -> str:
        parts_lower = [part.lower() for part in p.parts]
        has_fall = any(any(kw in part for kw in FALL_KEYWORDS) for part in parts_lower)
        has_adl  = any(any(kw in part for kw in ADL_KEYWORDS)  for part in parts_lower)
        if has_fall and not has_adl:
            return "fall"
        if has_adl and not has_fall:
            return "adl"
        # Check filename directly
        fname = p.stem.lower()
        if any(kw in fname for kw in FALL_KEYWORDS):
            return "fall"
        if any(kw in fname for kw in ADL_KEYWORDS):
            return "adl"
        return "ambiguous"

    for video_path in staging.rglob("*"):
        if video_path.is_file() and video_path.suffix.lower() in VIDEO_EXT:
            category = classify_path(video_path)
            # Flatten path into a unique filename to avoid collisions
            rel = video_path.relative_to(staging)
            flat_name = "__".join(rel.parts)

            if category == "fall":
                dest = dest_falls / flat_name
                shutil.copy2(video_path, dest)
                stats["falls"] += 1
                print(f"  [fall] {rel}")
            elif category == "adl":
                dest = dest_adl / flat_name
                shutil.copy2(video_path, dest)
                stats["adl"] += 1
                print(f"  [adl]  {rel}")
            else:
                stats["ambiguous"].append(str(video_path.relative_to(staging)))
                print(f"  [???]  Ambiguous: {rel}")

    return stats


# ──────────────────────────────────────────────
# 2.  URFD dataset  (direct HTTP)
# ──────────────────────────────────────────────

def download_urfd() -> dict:
    """
    Download all URFD RGB fall + ADL sequences and extract.
    Returns stats dict.
    """
    print("\n" + "="*60)
    print("  URFD Dataset  (fenix.ur.edu.pl)")
    print("="*60)

    raw_urfd_dir = RAW_DIR / "urfd_raw"
    raw_urfd_dir.mkdir(parents=True, exist_ok=True)

    stats = {"falls": 0, "adl": 0, "ambiguous": [], "errors": []}

    # ── Build URL list ───────────────────────────────────────
    # Falls: sequences 01-30, cam0 and cam1 both have RGB
    fall_urls = []
    for n in range(1, URFD_FALL_COUNT + 1):
        seq = f"{n:02d}"
        fall_urls.append(f"{URFD_BASE_URL}/fall-{seq}-cam0-rgb.zip")
        fall_urls.append(f"{URFD_BASE_URL}/fall-{seq}-cam1-rgb.zip")

    # ADL: sequences 01-40, cam0 ONLY (dataset description says ADL recorded with one device)
    adl_urls = []
    for n in range(1, URFD_ADL_COUNT + 1):
        seq = f"{n:02d}"
        adl_urls.append(f"{URFD_BASE_URL}/adl-{seq}-cam0-rgb.zip")

    # ── Download falls ────────────────────────────────────────
    print(f"\n[->] Downloading {len(fall_urls)} URFD fall RGB zips ...")
    for url in fall_urls:
        fname = url.split("/")[-1]
        zip_dest = RAW_DIR / fname
        ok = download_file(url, zip_dest, label=fname)
        if ok:
            seq_name = fname.replace(".zip", "")
            extract_to = raw_urfd_dir / seq_name
            if not extract_to.exists():
                safe_extractall(zip_dest, extract_to, fname)
            n_copied = _copy_image_frames(extract_to, URFD_DIR / "falls" / seq_name)
            stats["falls"] += n_copied
            if n_copied > 0:
                print(f"  [fall] {seq_name}: {n_copied} frames")
        else:
            stats["errors"].append(url)

    # ── Download ADL ──────────────────────────────────────────
    print(f"\n[->] Downloading {len(adl_urls)} URFD ADL RGB zips ...")
    for url in adl_urls:
        fname = url.split("/")[-1]
        zip_dest = RAW_DIR / fname
        ok = download_file(url, zip_dest, label=fname)
        if ok:
            seq_name = fname.replace(".zip", "")
            extract_to = raw_urfd_dir / seq_name
            if not extract_to.exists():
                safe_extractall(zip_dest, extract_to, fname)
            n_copied = _copy_image_frames(extract_to, URFD_DIR / "adl" / seq_name)
            stats["adl"] += n_copied
            if n_copied > 0:
                print(f"  [adl]  {seq_name}: {n_copied} frames")
        else:
            stats["errors"].append(url)

    return stats


def _copy_image_frames(src: Path, dest: Path) -> int:
    """
    Copy all PNG/JPG image frames from src tree into dest (flat).
    Returns number of images copied.
    """
    IMAGE_EXT = {".png", ".jpg", ".jpeg"}
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    for img in src.rglob("*"):
        if img.is_file() and img.suffix.lower() in IMAGE_EXT:
            target = dest / img.name
            # Avoid name collision: prefix with parent dir name
            if target.exists():
                target = dest / f"{img.parent.name}_{img.name}"
            shutil.copy2(img, target)
            count += 1
    return count


# ──────────────────────────────────────────────
# 3.  Summary report
# ──────────────────────────────────────────────

def print_summary(le2i_stats: dict, urfd_stats: dict):
    print("\n" + "="*60)
    print("  DOWNLOAD & ORGANISATION SUMMARY")
    print("="*60)

    def count_files(p: Path) -> int:
        if not p.exists():
            return 0
        return sum(1 for _ in p.rglob("*") if _.is_file())

    le2i_falls = count_files(LE2I_DIR / "falls")
    le2i_adl   = count_files(LE2I_DIR / "adl")
    urfd_falls = count_files(URFD_DIR / "falls")
    urfd_adl   = count_files(URFD_DIR / "adl")
    raw_count  = count_files(RAW_DIR)

    print(f"""
  datasets/
    le2i/
      falls/    {le2i_falls:>6} file(s)  (videos)
      adl/      {le2i_adl:>6} file(s)  (videos)
    urfd/
      falls/    {urfd_falls:>6} file(s)  (image frames across sequences)
      adl/      {urfd_adl:>6} file(s)  (image frames across sequences)

  raw_downloads/  {raw_count:>6} file(s)  (zips kept for re-extraction)
""")

    all_errors    = le2i_stats.get("errors", []) + urfd_stats.get("errors", [])
    all_ambiguous = le2i_stats.get("ambiguous", []) + urfd_stats.get("ambiguous", [])

    if all_errors:
        print(f"[WARN] FAILED DOWNLOADS ({len(all_errors)}) - review manually:")
        for e in all_errors:
            print(f"    FAIL  {e}")
    else:
        print("[OK] All downloads succeeded.")

    if all_ambiguous:
        print(f"\n[WARN] AMBIGUOUS LABELS ({len(all_ambiguous)}) - could not auto-classify:")
        for a in all_ambiguous:
            print(f"    ???  {a}")
        print("      -> These were NOT copied to falls/ or adl/.")
        print(f"         Check raw_downloads/le2i_raw/ manually and move as needed.")
    else:
        print("[OK] No ambiguous files.")

    print("\n[DONE] Dataset preparation complete.")


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Secure Elder Care — Fall Dataset Downloader & Organiser",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download only URFD (Le2i skipped — provide zip later)
  python download_datasets.py

  # Process a manually downloaded Le2i zip AND download URFD
  python download_datasets.py --le2i-zip "C:/Downloads/falldataset-imvia.zip"

  # Only process Le2i (URFD already downloaded)
  python download_datasets.py --le2i-zip "C:/Downloads/falldataset-imvia.zip" --skip-urfd
""",
    )
    parser.add_argument(
        "--le2i-zip",
        metavar="PATH",
        help="Path to a manually downloaded Le2i zip to classify into falls/ and adl/",
        default=None,
    )
    parser.add_argument(
        "--skip-urfd",
        action="store_true",
        help="Skip URFD download (use when URFD is already complete)",
    )
    args = parser.parse_args()

    print("Secure Elder Care - Dataset Downloader & Organiser")
    print(f"  Base dir : {BASE_DIR}")
    print(f"  Datasets : {DATASETS_DIR}")
    print(f"  Raw zips : {RAW_DIR}")

    # ── Create directory tree ────────────────────────────────
    print("\n[setup] Creating directory structure ...")
    make_dirs()

    # ── Le2i ─────────────────────────────────────────────────
    le2i_stats = {"falls": 0, "adl": 0, "ambiguous": [], "errors": []}

    if args.le2i_zip:
        zip_path = Path(args.le2i_zip)
        if not zip_path.exists():
            print(f"\n[Le2i] FAIL — zip not found: {zip_path}")
            le2i_stats["errors"].append(f"zip not found: {zip_path}")
        else:
            print(f"\n[Le2i] Processing manual zip: {zip_path.name}")
            raw_zip = RAW_DIR / zip_path.name
            if not raw_zip.exists():
                shutil.copy2(zip_path, raw_zip)
                print(f"  [copy] Archived to raw_downloads/{zip_path.name}")
            staging = RAW_DIR / "le2i_raw"
            staging.mkdir(parents=True, exist_ok=True)
            if staging.exists() and any(staging.iterdir()):
                print(f"  [skip] Already extracted to {staging.name}/")
            else:
                print(f"  [ext]  Extracting to {staging.name}/ ...")
                safe_extractall(raw_zip, staging, raw_zip.name)
            print("\n  [info] Le2i folder structure (first 3 levels):")
            _print_tree(staging, max_depth=3)
            le2i_stats = _classify_le2i(staging)
    else:
        print("\n[Le2i] SKIPPED — no --le2i-zip provided.")
        print("  Download from: https://www.kaggle.com/datasets/tuyenldvn/falldataset-imvia")
        print("  Then re-run:   python download_datasets.py --le2i-zip <path/to/zip>")

    # ── URFD ─────────────────────────────────────────────────
    if args.skip_urfd:
        print("\n[URFD] SKIPPED (--skip-urfd flag set).")
        urfd_stats = {"falls": 0, "adl": 0, "ambiguous": [], "errors": []}
    else:
        print("\n[URFD] Downloading dataset (direct HTTP) ...")
        urfd_stats = download_urfd()

    # ── Summary ──────────────────────────────────────────────
    print_summary(le2i_stats, urfd_stats)


if __name__ == "__main__":
    main()
