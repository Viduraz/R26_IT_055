import httpx
import asyncio

async def test_api():
    async with httpx.AsyncClient() as client:
        # Try correct password
        payload = {"email": "testdevindu@gmail.com", "password": "123"}
        resp = await client.post("http://localhost:8000/api/auth/login", json=payload)
        print("Response for '123':", resp.status_code, resp.text)
        
        # Try full password
        payload = {"email": "testdevindu@gmail.com", "password": "12345"}
        resp = await client.post("http://localhost:8000/api/auth/login", json=payload)
        print("Response for '12345':", resp.status_code, resp.text)

if __name__ == "__main__":
    asyncio.run(test_api())
