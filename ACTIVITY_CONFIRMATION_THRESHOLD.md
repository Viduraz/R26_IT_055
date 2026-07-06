# 3-Second Activity Confirmation Threshold

## Overview
The system now requires activities to be continuously detected for **3 seconds** before marking them in the schedule. This prevents false positives from brief detection blips and ensures robust activity recognition.

## Problem Solved
Previously, temporary motion or brief pose changes could trigger false activity detections, causing incorrect schedule entries. Now the system validates the activity is sustained before logging it.

## Implementation Details

### File: `schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx`

#### 1. **Activity Confirmation State** (Lines 133-140)
```javascript
const activityConfirmationRef = useRef({
  activityName: null,                // Currently being tracked
  startTime: null,                   // When detection started
  timeoutId: null,                   // Confirmation timer ID
  confirmedActivities: {}            // Track which activities confirmed
});
```

#### 2. **Confirmation Function** (Lines 213-248)
```javascript
const confirmActivityForLogging = (detectionData) => {
  const CONFIRMATION_TIME = 3000;  // 3 second threshold
  
  // If activity changes, reset timer
  if (confirmation.activityName !== detectionData.activity_name) {
    // Start new 3-second confirmation period
    clearTimeout(confirmation.timeoutId);
    confirmation.activityName = detectionData.activity_name;
    confirmation.startTime = now;
    confirmation.timeoutId = setTimeout(() => {
      confirmation.confirmedActivities[activity] = true;
    }, CONFIRMATION_TIME);
    return false;  // Not yet confirmed
  }
  
  // Same activity - check if 3 seconds elapsed
  const elapsedTime = now - confirmation.startTime;
  if (elapsedTime >= CONFIRMATION_TIME && !isConfirmed) {
    return true;  // Confirmed!
  }
  
  return isConfirmed;
}
```

#### 3. **Detection Flow** (Lines 290-305)
```javascript
// 1. Check 3-second confirmation first
const isActivityConfirmed = confirmActivityForLogging(detectionData);

// 2. If not confirmed, show in UI but don't log
if (!isActivityConfirmed) {
  return;  // Wait for 3 seconds
}

// 3. After 3 seconds confirmed, apply debounce and other checks
if (now - lastTime < DETECTION_DEBOUNCE) return;
if (detectionData.confidence < CONFIDENCE_THRESHOLD) return;

// 4. Finally log to schedule
await logDetectedActivity(...)
```

#### 4. **Cleanup on Stop** (Lines 402-410)
```javascript
const stopDetection = async () => {
  // Clear confirmation timer
  if (activityConfirmationRef.current.timeoutId) {
    clearTimeout(activityConfirmationRef.current.timeoutId);
  }
  
  // Reset state
  activityConfirmationRef.current.activityName = null;
  activityConfirmationRef.current.confirmedActivities = {};
  
  await stopPoseDetection();
  // ...
};
```

#### 5. **Component Unmount Cleanup** (Lines 173-179)
```javascript
useEffect(() => {
  return () => {
    if (activityConfirmationRef.current.timeoutId) {
      clearTimeout(activityConfirmationRef.current.timeoutId);
    }
  };
}, []);
```

## Activity Detection Timeline

### Before (Old System)
```
Frame 1: Activity detected → Immediately log to schedule ❌ (False positive risk)
Frame 2-10: Different activity or noise
```

### After (New System)
```
Frame 1 (t=0ms):     Activity "Eating" detected
                     → Start 3-second confirmation timer ⏳
Frame 2 (t=33ms):    Still detecting "Eating"
                     → Timer continues
...
Frame 60 (t=1980ms): Still detecting "Eating"
                     → Timer at 2 seconds
Frame 91 (t=3000ms): Still detecting "Eating"
                     → ✅ 3 seconds passed! Activity confirmed
                     → Log to schedule
```

### Scenario: Activity Changes Before 3 Seconds
```
Frame 1 (t=0ms):     "Eating" detected
                     → Start 3-second confirmation timer
Frame 10 (t=330ms):  "Eating" stops, "Sitting" detected
                     → ❌ Timer reset! "Eating" confirmation cancelled
                     → New 3-second timer for "Sitting" starts
Frame 11-20:         Brief noise or gesture
Frame 91 (t=3000ms): "Eating" still not sustained → NOT logged
```

## Parameter Tuning

### Adjustable Thresholds:
- `CONFIRMATION_TIME = 3000` (milliseconds)
  - Current: 3 seconds (3000ms)
  - Increase for more strict confirmation (e.g., 5000ms for elderly with tremors)
  - Decrease for faster logging (e.g., 1500ms for quick activities)

- Existing debounce: `DETECTION_DEBOUNCE = 2000` (2 seconds)
  - Prevents same activity being logged multiple times
  - Applies AFTER 3-second confirmation

- Confidence threshold: `CONFIDENCE_THRESHOLD = 0.50` (50%)
  - Must be met after confirmation passes

## Detection Logic Order

The system now enforces this checking order:

1. ✅ **3-Second Confirmation** (NEW)
   - Must detect same activity for 3 seconds continuously
   - If activity changes, timer resets
   - Only proceed if confirmed

2. **Debounce Check** (Existing)
   - Prevent same activity being logged within 2 seconds
   - Protects backend from duplicate entries

3. **Confidence Check** (Existing)
   - Must have ≥50% confidence
   - Filters weak detections

4. **Filter Generic Activities** (Existing)
   - Ignore "Movement" activity to reduce noise

5. **Schedule Validation** (Existing)
   - Check if activity is in user's schedule

6. **Backend Logging** (Existing)
   - Send confirmed activity to backend
   - Backend applies adaptive thresholds

## User Experience

### What Users See:

**During Detection (No Logging Yet):**
- Purple popup shows detected activity
- Live confidence bar updates in real-time
- Debug info shows detection signals

**After 3 Seconds Confirmation:**
- Activity automatically logged to schedule
- Status appears in detection log
- Backend validates timing (on-time, late, etc.)

### Example Scenarios:

| Scenario | Behavior |
|----------|----------|
| **Person eats for 5 seconds** | ✅ Detected after 3s, logged |
| **Brief hand gesture (1 second)** | ⏭️ Skipped (< 3s), not logged |
| **Multiple quick movements** | ⏭️ Skipped, only sustained acts logged |
| **Eating interrupted at 2 seconds** | ⏭️ Timer resets if activity changes |
| **Eating resumes after 0.5s** | ✅ Confirmation continues (same activity) |

## Performance Impact

| Aspect | Impact |
|--------|--------|
| **CPU Usage** | None (timer-based, no extra computation) |
| **Memory** | +~1KB for confirmation state |
| **Latency** | +3000ms (intentional: 3-second confirmation) |
| **Backend Load** | ✅ Reduced (fewer false positives logged) |

## Testing Recommendations

1. **Quick Gesture Test**: Wave hand for 1 second
   - Expected: NOT logged (< 3 seconds)
   
2. **Sustained Activity Test**: Eat/walk for 5 seconds
   - Expected: Logged after 3 seconds confirmation
   
3. **Activity Switch Test**: Start eating, switch to walking at 2 seconds
   - Expected: Neither logged (both < 3 seconds each)
   
4. **Activity Resume Test**: Eat for 4 seconds, pause 0.5s, eat again for 4 seconds
   - Expected: First eating logged after 3s, second continues confirmation OR resets based on pose breaks
   
5. **Low Confidence Test**: Brief high-confidence detection followed by low-confidence movements
   - Expected: Only logged if confirmed for 3 seconds at 50%+ confidence

## Future Enhancements

1. **Activity-Specific Thresholds**
   - Different confirmation times for different activities
   - E.g., "Eating" = 3s, "Walking" = 2s, "Sleeping" = 5s

2. **Confidence-Based Thresholds**
   - Higher confidence = faster confirmation
   - Lower confidence = longer confirmation

3. **User Preferences**
   - Allow elderly users to adjust confirmation time
   - Trade-off: Speed vs. accuracy

4. **Machine Learning**
   - Learn optimal confirmation time based on user behavior
   - Adapt to tremors, shakes, or movement disorders

## Debug Information

When confirmation is active, developers can check:
```javascript
// In browser console
activityConfirmationRef.current

// Output:
{
  activityName: "Eating",
  startTime: 1718764000000,
  timeoutId: 123,
  confirmedActivities: {
    "Eating": true,
    "Walking": false
  }
}
```

## References

- **Confirmation Window:** 3 seconds (3000ms)
- **Debounce Window:** 2 seconds (2000ms)
- **Confidence Threshold:** 50% (0.50)
- **Activity Classes:** 7 (Sleep, Eating, Drinking, Medications, Walking, Sitting, Movement)
