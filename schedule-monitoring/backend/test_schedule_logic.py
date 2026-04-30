import os
import sys
from datetime import datetime, timedelta

# Ensure correct path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Mock the get_db function
sys.modules['shared'] = type('MockShared', (), {})()
sys.modules['shared.backend'] = type('MockSharedBackend', (), {})()
sys.modules['shared.backend.config'] = type('MockSharedBackendConfig', (), {})()
sys.modules['shared.backend.config.database'] = type('MockSharedDB', (), {'get_db': lambda *args, **kwargs: mock_db})()

# Mock MongoDB collections
class MockCollection:
    def __init__(self):
        self.data = []
    
    def insert_one(self, doc):
        doc['_id'] = 'mock_id'
        self.data.append(doc)
        return type('Result', (), {'inserted_id': 'mock_id'})()
        
    def find_one(self, query):
        for doc in self.data:
            match = True
            for k, v in query.items():
                if isinstance(v, dict) and '$gte' in v:
                    if not (doc.get(k) and v['$gte'] <= doc[k] <= v['$lte']):
                        match = False
                elif doc.get(k) != v:
                    match = False
            if match:
                return doc
        return None
        
    def find(self, query):
        res = []
        for doc in self.data:
            match = True
            for k, v in query.items():
                if doc.get(k) != v:
                    match = False
            if match:
                res.append(doc)
        class Cursor:
            def __init__(self, data): self.data = data
            def sort(self, *args): return self
            def limit(self, *args): return self
            def __iter__(self): return iter(self.data)
        return Cursor(res)

mock_db = {
    "schedules": MockCollection(),
    "activity_logs": MockCollection(),
    "notifications": MockCollection(),
    "deviations": MockCollection()
}

from app.services.schedule_service import ScheduleService

def run_tests():
    svc = ScheduleService()
    now = datetime.now()
    
    # 1. Setup mock schedule
    mock_db["schedules"].insert_one({
        "schedule_id": "test_schedule_1",
        "user_id": "test_user",
        "activities": [
            {
                "activity_name": "Eating",
                "start_time": (now - timedelta(minutes=10)).strftime("%H:%M"),
                "end_time": (now + timedelta(minutes=20)).strftime("%H:%M")
            },
            {
                "activity_name": "Walking",
                "start_time": (now - timedelta(minutes=60)).strftime("%H:%M"),
                "end_time": (now - timedelta(minutes=30)).strftime("%H:%M") # Missed!
            }
        ]
    })
    
    # 2. Test "Done" (within 20 mins)
    res = svc.log_activity_detection(
        schedule_id="test_schedule_1",
        activity_name="Eating",
        detected_at=now,
        confidence=0.9,
        signals={}
    )
    assert res['status'] == 'Done', f"Expected Done, got {res['status']}"
    assert len(mock_db['notifications'].data) == 0, "Should not create notification for Done"
    print("✅ 'Done' logic passed")

    # 3. Test "Late" (after 20 mins)
    start_time_obj = datetime.strptime(mock_db['schedules'].data[0]['activities'][0]['start_time'], "%H:%M").time()
    expected_start = datetime.combine(now.date(), start_time_obj)
    
    status_info = svc.check_activity_status(expected_start, expected_start + timedelta(minutes=25))
    assert status_info['status'] == 'Late', f"Expected Late, got {status_info['status']}"
    print("✅ 'Late' logic passed")
    
    # 4. Test "Missed" (background task)
    svc.check_missed_activities()
    logs = mock_db['activity_logs'].data
    missed_logs = [l for l in logs if l['activity_name'] == 'Walking']
    assert len(missed_logs) == 1, "Should have created a missed log for Walking"
    assert missed_logs[0]['status'] == 'Missed', "Log should have status Missed"
    
    notifs = mock_db['notifications'].data
    assert len(notifs) == 1, "Should have created a notification for Missed activity"
    assert notifs[0]['status'] == 'Missed', "Notification should be for Missed"
    print("✅ 'Missed' background job logic passed")

if __name__ == "__main__":
    run_tests()
