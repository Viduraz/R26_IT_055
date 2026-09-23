# 🚶 Walking Detection - Quick Reference

## The Three Thresholds (All Must Pass)

### 1️⃣ ARM MOVEMENT
- **Check:** Arms swinging/moving?
- **Threshold:** `armMovement >= 0.008`
- **How it works:** Measures wrist oscillation + elbow height variation
- **Why:** Natural walking includes arm swing

### 2️⃣ LEG MOVEMENT
- **Check:** Legs moving (alternating)?
- **Threshold:** `legAsymmetry >= 4° OR velocity >= 0.015`
- **How it works:** Checks if legs show walking pattern (one bent, one straight)
- **Why:** Walking has alternating leg positions

### 3️⃣ UPRIGHT POSTURE
- **Check:** Body standing straight (not sitting/lying)?
- **Threshold:** `bothLegs > 145° AND bodyHeight > 0.50`
- **How it works:** Verifies legs are extended and body is tall
- **Why:** Walking requires standing posture

---

## Console Output

When walking is detected, you'll see:

```
Walking detected!
Confidence: 0.88
Threshold 1 (Arm Movement): ✓ PASS
Threshold 2 (Leg Movement): ✓ PASS
Threshold 3 (Upright Posture): ✓ PASS
Thresholds Met: 3/3
```

When it fails, you'll see:

```
Not walking - threshold(s) failed:
Threshold 1 (Arm Movement): ✗ FAIL (0.003 < 0.008)
Threshold 2 (Leg Movement): ✓ PASS
Threshold 3 (Upright Posture): ✓ PASS
Thresholds Met: 2/3
```

---

## Testing It Out

1. **Walk naturally** → Should detect "Walking" ✓
2. **Walk with arms at sides** → Won't detect (expected) ✗
3. **Stand still** → Won't detect (expected) ✗
4. **Walk quickly** → Should detect with high confidence ✓
5. **Sit down** → Won't detect (shows "Sitting / rest") ✗

---

## If Walking Isn't Detected

**Problem:** Threshold 1 fails (arm not moving enough)
```
Solution: Lower WALKING_ARM_VELOCITY_MIN from 0.008 to 0.005
Edit: schedule-monitoring/frontend/src/services/activityDetection.js, line ~57
```

**Problem:** Threshold 2 fails (leg movement too small)
```
Solution: Lower WALKING_LEG_ASYMMETRY_MIN from 4.0 to 2.5
Edit: schedule-monitoring/frontend/src/services/activityDetection.js, line ~59
```

**Problem:** Threshold 3 fails (not standing straight enough)
```
Solution: Lower WALKING_LEGS_STRAIGHT_THRESHOLD from 145 to 140
Edit: schedule-monitoring/frontend/src/services/activityDetection.js, line ~60
```

---

## Files Modified

- ✅ `schedule-monitoring/frontend/src/services/activityDetection.js` 
  - Added threshold constants (lines 53-60)
  - Added `detectWalkingWithThresholds()` function
  - Updated `classifyActivity()` to use new detector

---

## How It Changed

**Before:**
```javascript
// Single combined check
if (legsStraight && bodyHeight > 0.55 && 
    velocity >= 0.018 && 
    legAsymmetry >= 6) {
  activity = 'Walking';
}
```

**After:**
```javascript
// Three independent thresholds (all must pass)
const walkingResult = detectWalkingWithThresholds(features, poseSequence);
if (walkingResult.isWalking) {
  activity = 'Walking';
  confidence = walkingResult.confidence;
}
```

---

## Key Advantages

✅ **More reliable** - Three independent checks  
✅ **Natural motion** - Requires arm swing (like real walking)  
✅ **Less false positives** - All three must pass  
✅ **Detailed signals** - See which threshold passed/failed  
✅ **Tunable** - Each threshold independently adjustable  

---

## The Three Thresholds Visually

```
Walking Person:
┌─────────┐
│ Head ↑  │
│ (high)  │
├─────────┤
│ Shoulders→← (arms swinging)
│ /   \
│/     \  (legs alternating)
└─────────┘
  ↑   ↑  (feet moving)

Sitting Person:
┌─────────┐
│ Head ↓  │
│ (low)   │
├─────────┤
│ Shoulders-  (arms still)
│ |   |
│ |   |  (legs static)
└─────────┘
  ↓   ↓  (feet still)
```

---

## Confidence Scores

- **0.95:** Walking briskly with full arm swing
- **0.88:** Normal walking pace with arm swing
- **0.75:** Minimal walking pattern but all thresholds pass
- **< 0.75:** Not walking (fewer thresholds pass)

---

## Next Steps

1. **Test it:** Walk in front of camera and check console (F12)
2. **If it works:** Great! You're done.
3. **If it doesn't:** Refer to "If Walking Isn't Detected" section
4. **For details:** Read `WALKING_DETECTION_GUIDE.md`

---

**Status:** ✅ ACTIVE & READY  
**Location:** `schedule-monitoring/frontend/src/services/activityDetection.js`  
**Last Updated:** 2026-08-31
