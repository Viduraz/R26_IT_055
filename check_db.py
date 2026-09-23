import os
import sys
import asyncio

# Add project root to path
sys.path.append(r'c:\Secure-Eldercare-Project')
sys.path.append(r'c:\Secure-Eldercare-Project\auth-service\backend')

from shared.backend.config.database import get_db
from app.models.user_model import user_collection
from app.services.password_service import verify_password

async def main():
    db = get_db()
    users = list(user_collection().find({"email": "testdevindu@gmail.com"}))
    if not users:
        print("User not found")
        return
    u = users[0]
    pwd_hash = u.get("password_hash")
    print(f"Password hash: {pwd_hash}")
    
    for pwd in ["admin", "12345", "password", "testdevindu", "test"]:
        is_valid = verify_password(pwd, pwd_hash)
        print(f"Pwd '{pwd}': {is_valid}")

if __name__ == "__main__":
    asyncio.run(main())
