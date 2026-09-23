import httpx
import asyncio

async def test_register():
    async with httpx.AsyncClient() as client:
        # Register user
        payload = {
            "name": "Live Test",
            "email": "livetest@gmail.com",
            "password": "password",
            "role": "family_member"
        }
        print("Registering...")
        resp = await client.post("http://localhost:8000/api/auth/register", json=payload)
        print("Register response:", resp.status_code, resp.text)
        
        # Login
        print("Logging in...")
        resp = await client.post("http://localhost:8000/api/auth/login", json={"email": "livetest@gmail.com", "password": "password"})
        print("Login response:", resp.status_code, resp.text)

if __name__ == "__main__":
    asyncio.run(test_register())
