"""
fix_admin_password.py  — targeted reset for testadmin@gmail.com
Run from project root with any venv that has pymongo, bcrypt, certifi, python-dotenv:
  python fix_admin_password.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

import bcrypt
import certifi
from pymongo import MongoClient
from shared.backend.config.settings import settings

# ── CONFIG ──────────────────────────────────────────────
TARGET_EMAIL  = "himz@gmail.com"
NEW_PASSWORD  = "12345"
# ────────────────────────────────────────────────────────

client = MongoClient(
    settings.MONGODB_URI,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=10000,
    retryWrites=False,
)
client.admin.command('ping')
print("[OK] Connected to MongoDB Atlas")

db = client[settings.MONGODB_DB_NAME]
users_col = db["users"]

new_hash = bcrypt.hashpw(NEW_PASSWORD.encode(), bcrypt.gensalt()).decode()

# Targeted update — only the specific admin account
result = users_col.update_one(
    {"email": TARGET_EMAIL},
    {"$set": {"password_hash": new_hash}}
)
print(f"matched={result.matched_count}  modified={result.modified_count}")

if result.matched_count == 0:
    print(f"[ERROR] No user found with email '{TARGET_EMAIL}'")
elif result.modified_count == 1:
    print(f"[OK] Password for {TARGET_EMAIL} reset to: {NEW_PASSWORD}")
    # Verify the hash we just wrote
    u = users_col.find_one({"email": TARGET_EMAIL})
    stored = u.get("password_hash", "")
    ok = bcrypt.checkpw(NEW_PASSWORD.encode(), stored.encode()) if stored else False
    print(f"[VERIFY] bcrypt.checkpw → {ok}")
else:
    print("[WARN] Document was already up to date (no change made)")

client.close()
