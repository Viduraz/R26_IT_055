import requests
import json
from datetime import datetime, timedelta

# Calculate relative times based on current system clock
now = datetime.now()
# Start in 1 minute
start = now + timedelta(minutes=1)
# End 3 minutes after start
end = start + timedelta(minutes=3)

start_str = start.strftime("%H:%M")
end_str = end.strftime("%H:%M")

payload = {
    "description": "Live Panel Demo (3min Active + 1.5min Grace)",
    "activities": [
        {
            "activity_name": "Drinking",
            "start_time": start_str,
            "end_time": end_str
        }
    ]
}

url = "http://localhost:8004/api/schedule/"
headers = {"Content-Type": "application/json"}

try:
    # First get existing schedules and delete them to prevent clutter
    existing = requests.get(url).json()
    for sch in existing:
        requests.delete(f"{url}{sch['schedule_id']}")
        print(f"Cleared existing schedule {sch['schedule_id']}")

    # Create new schedule
    resp = requests.post(url, json=payload, headers=headers)
    if resp.status_code == 200 or resp.status_code == 201:
        print(f"✅ SUCCESS! Created demo schedule.")
        print(f"Activity: Drinking")
        print(f"⏰ Start: {start_str}")
        print(f"⏰ End: {end_str}")
        print(f"🚨 Deviation Alert (Missed) will fire at: {(end + timedelta(minutes=1.5)).strftime('%H:%M')}")
    else:
        print(f"Failed: {resp.status_code} - {resp.text}")
except Exception as e:
    print(f"Error: {e}")
