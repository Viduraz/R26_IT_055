#!/usr/bin/env python3
"""
Generate sample schedules in the system for testing activity detection.
This script creates realistic daily schedules for elderly care monitoring.
"""

import sys
import os
from pathlib import Path
from datetime import datetime
import uuid
import json

# Add project root to python path
root_dir = Path(__file__).resolve().parents[0]
sys.path.insert(0, str(root_dir))

from dotenv import load_dotenv
load_dotenv(root_dir / ".env")

# MongoDB connection
from shared.backend.config.database import get_db


def generate_sample_schedules():
    """Generate realistic sample schedules for activity detection testing."""
    
    db = get_db()
    schedules = db["schedules"]
    
    # Sample 1: Morning Routine Schedule
    schedule_morning = {
        "schedule_id": str(uuid.uuid4()),
        "user_id": "dev-user",
        "activities": [
            {
                "activity_name": "Standing up",
                "start_time": "06:00",
                "end_time": "06:30"
            },
            {
                "activity_name": "Eating",
                "start_time": "06:30",
                "end_time": "07:00"
            },
            {
                "activity_name": "Walking",
                "start_time": "07:00",
                "end_time": "07:30"
            },
            {
                "activity_name": "Sitting / rest",
                "start_time": "07:30",
                "end_time": "08:00"
            }
        ],
        "description": "Morning routine schedule - activities in sequence",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "active": True
    }
    
    # Sample 2: Full Day Schedule
    schedule_fullday = {
        "schedule_id": str(uuid.uuid4()),
        "user_id": "dev-user",
        "activities": [
            {
                "activity_name": "Standing up",
                "start_time": "07:00",
                "end_time": "07:30"
            },
            {
                "activity_name": "Eating",
                "start_time": "07:30",
                "end_time": "08:00"
            },
            {
                "activity_name": "Walking",
                "start_time": "08:00",
                "end_time": "09:00"
            },
            {
                "activity_name": "Sitting / rest",
                "start_time": "09:00",
                "end_time": "12:00"
            },
            {
                "activity_name": "Eating",
                "start_time": "12:00",
                "end_time": "12:30"
            },
            {
                "activity_name": "Walking",
                "start_time": "12:30",
                "end_time": "13:00"
            },
            {
                "activity_name": "Sitting / rest",
                "start_time": "13:00",
                "end_time": "17:00"
            },
            {
                "activity_name": "Eating",
                "start_time": "17:00",
                "end_time": "17:30"
            },
            {
                "activity_name": "Walking",
                "start_time": "17:30",
                "end_time": "18:00"
            },
            {
                "activity_name": "Sitting / rest",
                "start_time": "18:00",
                "end_time": "20:00"
            },
            {
                "activity_name": "Sleep",
                "start_time": "20:00",
                "end_time": "07:00"
            }
        ],
        "description": "Full day schedule - realistic daily routine",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "active": True
    }
    
    # Sample 3: Activity Testing Schedule (for testing each activity)
    schedule_testing = {
        "schedule_id": str(uuid.uuid4()),
        "user_id": "dev-user",
        "activities": [
            {
                "activity_name": "Standing up",
                "start_time": "08:00",
                "end_time": "08:15"
            },
            {
                "activity_name": "Eating",
                "start_time": "08:15",
                "end_time": "08:30"
            },
            {
                "activity_name": "Walking",
                "start_time": "08:30",
                "end_time": "08:45"
            },
            {
                "activity_name": "Sitting / rest",
                "start_time": "08:45",
                "end_time": "09:00"
            },
            {
                "activity_name": "Sleep",
                "start_time": "09:00",
                "end_time": "09:15"
            }
        ],
        "description": "Test schedule - all 5 activities with short durations",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "active": True
    }
    
    # Check if schedules already exist
    existing = list(schedules.find({"user_id": "dev-user"}))
    
    if existing:
        print(f"⚠️  Found {len(existing)} existing schedules for dev-user")
        print("Existing schedules:")
        for sch in existing:
            print(f"  - {sch['schedule_id']}: {len(sch['activities'])} activities")
        print("\nSkipping creation to avoid duplicates.")
        return existing
    
    # Insert sample schedules
    print("📋 Creating sample schedules...\n")
    
    result1 = schedules.insert_one(schedule_morning)
    print(f"✅ Created Morning Routine Schedule")
    print(f"   ID: {schedule_morning['schedule_id']}")
    print(f"   Activities: {len(schedule_morning['activities'])}")
    print()
    
    result2 = schedules.insert_one(schedule_fullday)
    print(f"✅ Created Full Day Schedule")
    print(f"   ID: {schedule_fullday['schedule_id']}")
    print(f"   Activities: {len(schedule_fullday['activities'])}")
    print()
    
    result3 = schedules.insert_one(schedule_testing)
    print(f"✅ Created Activity Testing Schedule")
    print(f"   ID: {schedule_testing['schedule_id']}")
    print(f"   Activities: {len(schedule_testing['activities'])}")
    print()
    
    print("🎉 Sample schedules created successfully!\n")
    
    return [schedule_morning, schedule_fullday, schedule_testing]


def display_schedules():
    """Display all active schedules in the system."""
    db = get_db()
    schedules = db["schedules"]
    
    user_schedules = list(schedules.find({"user_id": "dev-user", "active": True}, {"_id": 0}))
    
    if not user_schedules:
        print("❌ No active schedules found for dev-user")
        return
    
    print("\n" + "="*80)
    print("📊 ACTIVE SCHEDULES FOR dev-user")
    print("="*80 + "\n")
    
    for schedule in user_schedules:
        print(f"Schedule ID: {schedule['schedule_id']}")
        print(f"Description: {schedule.get('description', 'N/A')}")
        print(f"Created: {schedule['created_at'].strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Activities ({len(schedule['activities'])}):")
        print("-" * 80)
        
        for activity in schedule['activities']:
            print(f"  • {activity['activity_name']:20s} {activity['start_time']} - {activity['end_time']}")
        
        print("\n")


if __name__ == "__main__":
    try:
        print("\n🚀 Sample Schedule Generator")
        print("=" * 80 + "\n")
        
        schedules = generate_sample_schedules()
        display_schedules()
        
        print("=" * 80)
        print("✨ Ready to test activity detection!")
        print("=" * 80)
        print("\n💡 Next steps:")
        print("   1. Go to http://localhost:5178/")
        print("   2. Click 'Start Activity Monitoring'")
        print("   3. Perform activities in front of the camera:")
        print("      - Standing up (stand from seated/lying position)")
        print("      - Eating (sit and bring hand to mouth)")
        print("      - Walking (walk around)")
        print("      - Sitting (stay seated)")
        print("      - Sleep (lie down)")
        print("   4. Check the activity logs in the dashboard")
        print()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
