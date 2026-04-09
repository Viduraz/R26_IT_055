#!/bin/bash
# Sample schedule creation via API
# Run this after starting the backend server at http://localhost:8004

BASE_URL="http://localhost:8004"
ENDPOINT="/schedule"

echo "🚀 Creating sample schedules via API..."
echo ""

# Schedule 1: Morning Routine
echo "📋 Creating Morning Routine Schedule..."
curl -X POST "$BASE_URL$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "activities": [
      {
        "activity_name": "Wake up",
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
    "description": "Morning routine schedule - activities in sequence"
  }' | jq .
echo ""

# Schedule 2: Full Day
echo "📋 Creating Full Day Schedule..."
curl -X POST "$BASE_URL$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "activities": [
      {
        "activity_name": "Wake up",
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
    "description": "Full day schedule - realistic daily routine"
  }' | jq .
echo ""

# Schedule 3: Activity Testing
echo "📋 Creating Activity Testing Schedule..."
curl -X POST "$BASE_URL$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "activities": [
      {
        "activity_name": "Wake up",
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
    "description": "Test schedule - all 5 activities with short durations"
  }' | jq .
echo ""

echo "✅ Sample schedules created!"
echo ""
echo "Retrieve schedules with:"
echo "  curl http://localhost:8004/schedule"
