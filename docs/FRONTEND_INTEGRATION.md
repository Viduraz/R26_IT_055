# Frontend Integration - Phase 1: Adaptive Thresholds

**Status:** ✅ **IMPLEMENTED**  
**Date:** April 10, 2026  
**What's New:** React components now display ML-learned adaptive grace periods

---

## 🎯 What Changed in Frontend

### **New Status Types**
Instead of just `Done`/`Late`/`Missed`, you now see:

| Status | Meaning | Color | Icon | When |
|--------|---------|-------|------|------|
| **On Time** | Within adaptive grace period | 🟢 Green | ✓ | Activity detected < grace_minutes |
| **Slightly Late** | Beyond grace but acceptable | 🟡 Yellow | ⚠ | grace_minutes < delay < grace+18 |
| **Late** | Significantly delayed | 🔴 Red | ✕ | delay > grace+18 |
| **Unexpected** | Not in schedule | ⚪ Gray | ? | Activity not scheduled |

---

## 📁 Files Updated

### 1. **`scheduleApi.js`** (API Services)
**Added:** New optional validation endpoint
```javascript
export const validateActivityWithAdaptive = (scheduleId, activity) =>
  scheduleApi.post(`/logs/${scheduleId}/validate`, activity);
```
**Note:** Optional for now (using existing `logDetectedActivity` which now returns adaptive data)

### 2. **`ActivityDetectorMonitor.jsx`** (Live Detection Component)
**Updated to show:**
- ✅ Adaptive grace periods in real-time
- ✅ New status types with proper colors
- ✅ Grace period vs actual delay comparison
- ✅ Deadline in human-readable time

**New Display Format:**
```
Activity: Breakfast
Grace: 18min
Delay: 5min
Deadline: 07:18:00
Status: On Time
```

### 3. **`Reports.jsx`** (Activity History Page)
**Updated to:**
- ✅ Show all adaptive threshold fields
- ✅ Display grace period + delay side-by-side
- ✅ Color-code by new status types
- ✅ Show ML confidence levels

### 4. **`ScheduleDashboard.jsx`** (Main Dashboard)
**Updated to:**
- ✅ Display adaptive grace periods in recent logs
- ✅ Show new status types in KPI cards
- ✅ Show "On Time" vs "Late" counts separately

---

## 🔄 Data Flow

```
Frontend                Backend              Database
─────────────────────────────────────────────────────

1. User starts detection
   │
   ├─→ ML detects activity in video
   │
   ├─→ Send: {activity_name, confidence, detected_at}
   │        ↓
   │     get_adaptive_grace_period()
   │     ├─ Query last 50 detections
   │     ├─ Calculate mean + std_dev
   │     ├─ Return learned grace period
   │        ↓
   │     check_activity_status()
   │     ├─ Compare detected_at vs deadline
   │     ├─ Assign status & confidence
   │        ↓
   │     Save to DB with adaptive fields
   │        ↓
   ├─ Receive: {status, adaptive_grace_minutes, delay_minutes, deadline, confidence}
   │        ↓
   └─→ Display in UI with adaptive details
```

---

## 🎨 UI Components - Before & After

### **Before (Rule-Based)**
```
Activity: Breakfast
Time: 07:05:00
Status: Done ✓
```

### **After (Adaptive ML)**
```
Activity: Breakfast
Time: 07:05:00
Grace Period: 18 min (learned)
Actual Delay: 5 min
Deadline: 07:18:00
Status: On Time ✓
Confidence: 92%
```

---

## 🚀 How It Works

### **1. ActivityDetectorMonitor Component**

Displays live detection with adaptive details:

```jsx
// Real-time detection callback receives:
{
  activity_name: "Breakfast",
  confidence: 0.95,
  adaptive_grace_minutes: 18,    // NEW: learned from history
  delay_minutes: 5.0,            // NEW: actual delay
  deadline: "2026-04-10T07:18:00", // NEW: computed deadline
  status: "On Time",             // NEW: adaptive status
  status_confidence: 0.92        // NEW: ML confidence in status
}
```

**Display Shows:**
- ✅ Current activity in webcam overlay
- ✅ Real-time stats (Detected/On Time/Late)
- ✅ Recent detection log with grace period info
- ✅ Color-coded by adaptive status

### **2. Reports Component**

Detailed view of all activity logs with adaptive details:

```jsx
// Each log entry shows:
{
  activity_name: "Breakfast",
  detected_at: "2026-04-10T07:05:00Z",
  status: "On Time",
  adaptive_grace_minutes: 18,
  delay_minutes: 5.0,
  status_confidence: 0.92
}
```

**Features:**
- ✅ KPI cards showing breakdown (On Time/Slightly Late/Late)
- ✅ Detailed adaptive threshold info per activity
- ✅ Searchable/filterable by status
- ✅ Export-ready data format

### **3. ScheduleDashboard Component**

Overview dashboard showing recent activities with adaptive context:

```jsx
// Dashboard displays:
- Total activities scheduled
- Unread alerts (Late/Slightly Late)
- Recent activity logs with grace periods
- Visual comparison of expected vs actual
```

---

## 📊 Example Workflow

### **Scenario: Elder doing breakfast late**

```
Expected: 07:00
Actual Detection: 07:12

Adaptive Grace Period (learned from history): 18 minutes

Status Calculation:
  └─ Delay = 07:12 - 07:00 = 12 minutes
  └─ Is 12 <= 18? YES → Status = "On Time" ✓
  └─ Confidence = 92%

Frontend Display:
  ├─ Activity: Breakfast
  ├─ Time: 07:12:00
  ├─ Grace: 18 min (learned from 50+ past detections)
  ├─ Delay: 12 min
  ├─ Deadline: 07:18:00
  ├─ Status: On Time ✓ (92%)
  └─ Color: 🟢 Green
```

---

## 🔧 Installation & Setup

### **Step 1: Verify Dependencies**
```bash
cd schedule-monitoring/frontend
npm install
```

All React dependencies should already be installed.

### **Step 2: Backend Must Be Running**
```bash
cd schedule-monitoring/backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8004
```

### **Step 3: Start Frontend**
```bash
cd schedule-monitoring/frontend
npm run dev
```

**Access:** http://localhost:5173

---

## 🎯 Key Features to Try

### **1. Live Adaptive Detection**
- Open Schedule Dashboard
- Click "Show Detector"
- Perform activities in front of camera
- Observe real-time adaptive grace periods

### **2. View Adaptive Reports**
- Go to "Reports" page
- See all activities with grace periods
- Click on activity to see full adaptive details

### **3. Dashboard Overview**
- View "On Time" vs "Late" counts
- See unread alerts (Late/Slightly Late)
- Quick view of recent activities with delays

---

## 📝 Response Format

### **Activity Log Response from Backend**

When you detect an activity, the backend now returns:

```json
{
  "success": true,
  "activity_name": "Breakfast",
  "status": "On Time",
  "adaptive_grace_minutes": 18,
  "delay_minutes": 5.0,
  "deadline": "2026-04-10T07:18:00",
  "confidence": 0.92
}
```

**Frontend handles both old and new formats:**
- ✅ If `adaptive_grace_minutes` present: show adaptive details
- ✅ If not: fall back to basic status display

---

## 🎓 Component Props & State

### **ActivityDetectorMonitor Props**
```javascript
None - Uses hooks internally
```

### **State Managed**
```javascript
{
  isDetecting: boolean,
  currentActivity: {...},
  schedule: {...},
  detectionLogs: [...],
  stats: {
    detected: number,
    logged: number,
    onTime: number,
    late: number
  }
}
```

---

## 🚨 Troubleshooting

### **Problem: Logs show "Not Scheduled" (Unexpected)**
**Reason:** Activity name doesn't match schedule exactly  
**Solution:** Check activity name case-sensitivity, ensure it's in the schedule

### **Problem: Grace periods all show "..."**
**Reason:** Backend still initializing or API call failed  
**Solution:** Check backend is running, check browser console for API errors

### **Problem: Status shows as old type (Done/Late)**
**Reason:** Very old logs from before Phase 1 update  
**Solution:** New logs will have new status types, old ones will use legacy mapping

### **Problem: Adaptive grace always 20 minutes**
**Reason:** Less than 8 activity records, using fallback  
**Solution:** Let system run for a few days to collect enough history

---

## 📱 Responsive Design

All components are responsive:
- ✅ Mobile: Single column layout
- ✅ Tablet: 2-column grid
- ✅ Desktop: Full multi-column dashboard

---

## 🔐 Backend Requirements

For frontend to work properly, ensure backend has:
- ✅ `numpy` installed (for statistics)
- ✅ MongoDB running with `activity_logs` collection
- ✅ Updated `schedule_service.py` with adaptive methods
- ✅ `/logs/{schedule_id}/detect` endpoint returning adaptive data

---

## ✅ Frontend Integration Checklist

- [x] Updated API service with new endpoints
- [x] Updated ActivityDetectorMonitor with adaptive display
- [x] Updated Reports page with adaptive details
- [x] Updated ScheduleDashboard with grace periods
- [x] Added status color mapping for new types
- [x] Backward compatible with old status types
- [x] Error handling for missing data
- [x] Responsive design maintained
- [x] Documentation complete

**Frontend is ready for Phase 1! 🚀**

---

## 🎓 Next Steps

### **Phase 1 Testing**
1. Deploy frontend + backend
2. Run for 1-2 weeks with real data
3. Collect metrics on false alarm reduction
4. Verify grace periods are learning correctly

### **Phase 2 Planning**
After Phase 1 data collection:
- Implement Anomaly Detection
- Add behavioral clustering
- Create predictive alerts

---

## 📞 Support

### **Frontend Debugging**
- Check browser console (F12) for API errors
- Verify backend is running (`http://localhost:8004/api/schedule/`)
- Check network tab to see request/response format

### **Common Issues**
- CORS errors: Ensure backend has CORS enabled
- 404 on endpoints: Verify backend API paths match
- Stale data: Click "Refresh" button on dashboard

---

**Frontend Integration Complete! Your React app now displays ML-learned adaptive grace periods. 🎉**
