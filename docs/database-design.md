# Database Schema & Design

All microservices connect to **one shared MongoDB instance** defined by `MONGO_URI` in the root `.env` file. However, they maintain strict **table/collection isolation**. This means `auth-service` handles users, while `face-verification` handles face logs.

### Collection: `users` (Managed by `auth-service`)
- `_id`: ObjectId
- `username`: String (Unique)
- `email`: String (Unique)
- `password_hash`: String (Bcrypt)
- `role`: String (e.g., "admin", "caregiver")
- `created_at`: DateTime

### Collection: `face_logs` (Managed by `face-verification`)
- `_id`: ObjectId
- `timestamp`: DateTime
- `match`: Boolean
- `identity`: String (Optional, if match=True)
- `frame_reference`: String (URL or S3 bucket ref)

### Collection: `tracking_zones` (Managed by `tracking-geofencing`)
- `_id`: ObjectId
- `name`: String
- `polygon`: List[Tuple[float, float]] (Coordinates)

### Collection: `tracking_history`
- `_id`: ObjectId
- `timestamp`: DateTime
- `person_id`: String
- `location`: Tuple[float, float]
- `in_zone`: String (Zone Name)

### Collection: `anomaly_logs` (Managed by `anomaly-detection`)
- `_id`: ObjectId
- `timestamp`: DateTime
- `anomaly_detected`: Boolean
- `event_type`: String ("fall", "stillness", etc.)
- `confidence`: Float

### Collection: `schedules` (Managed by `schedule-monitoring`)
- `_id`: ObjectId
- `user_id`: ObjectId (Reference to Elder)
- `routine_name`: String
- `expected_time`: String (HH:MM format)

### Collection: `deviations`
- `_id`: ObjectId
- `detected_at`: DateTime
- `expected_activity`: String
- `observed_activity`: String
- `severity`: String ("high", "medium", "low")
