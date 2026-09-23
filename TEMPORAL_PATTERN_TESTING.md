# 🧪 Temporal Pattern Detection - Testing Guide

## Quick Start (2 minutes)

### 1. Start Backend
```bash
cd schedule-monitoring/backend
python3 run.py
# Expected: ✓ Server running on http://localhost:8004
```

### 2. Start Frontend
```bash
cd schedule-monitoring/frontend
npm run dev
# Expected: ➜ Local: http://localhost:5177
```

### 3. Open Browser & Enable Console
```
http://localhost:5177/schedule/monitoring
F12 → Console tab
```

### 4. Test Each Activity

---

## Test Cases

### 🚶 WALKING Test
**Expected**: Velocity-based detection

```
Step 1: Stand in front of camera
Step 2: Walk slowly toward camera
  ↓
Expected console output:
🚶 WALKING DETECTED - Velocity: 0.0150 Confidence: 0.65

Step 3: Walk faster
  ↓
Expected console output:
🚶 WALKING DETECTED - Velocity: 0.0350 Confidence: 0.90

Step 4: Walk very fast
  ↓
Expected console output:
🚶 WALKING DETECTED - Velocity: 0.0500 Confidence: 0.95
```

**Pass Criteria**:
- ✅ Slow walk: 0.65-0.80 confidence
- ✅ Normal walk: 0.80-0.90 confidence
- ✅ Fast walk: 0.90-0.95 confidence
- ❌ Standing still: NO "WALKING" message

---

### 🍽️ EATING Test
**Expected**: Repeated oscillation cycles required

**Setup**: Have a plate of food (or props) visible

```
Step 1: Position yourself with plate visible
Step 2: SLOWLY bring hand to mouth (one time)
        Pause 2-3 seconds
  ↓
Expected: NOT eating (only 1 cycle)
Reason: Need at least 2 cycles

Step 3: Repeat hand-to-mouth motion:
        Hand → Mouth → Down → Mouth → Down → Mouth
  ↓
Expected after 2-3 cycles:
🍽️  EATING DETECTED - Oscillation cycles: 2

Step 4: Continue eating motion (more cycles)
  ↓
Expected:
🍽️  EATING DETECTED - Oscillation cycles: 3
🍽️  EATING DETECTED - Oscillation cycles: 4
```

**Console Details**:
```javascript
Rule: eating_repeated_oscillation_with_food
Oscillation cycles: 3
Hand to mouth: 0.180
Food visible: true
Detected objects: ["plate"]
```

**Pass Criteria**:
- ✅ Repeated cycles detected (≥ 2)
- ✅ Confidence ~0.96
- ✅ Food object recognized
- ❌ Single hand-to-mouth: NOT eating
- ❌ Hand to mouth without food: NOT eating

---

### 💧 DRINKING Test
**Expected**: Single gesture motion required

**Setup**: Have a cup/bottle visible

```
Step 1: Position yourself with cup visible
Step 2: Bring cup to mouth (one smooth motion)
        Keep at mouth for 400-600ms
        Return hand down
  ↓
Expected:
💧 DRINKING DETECTED - Gesture status: completed

Step 3: Wait 1-2 seconds (cooldown)
Step 4: Take another sip
  ↓
Expected:
💧 DRINKING DETECTED - Gesture status: completed

Step 5: Quickly repeat sips (less than 800ms apart)
  ↓
Expected:
💧 DRINKING DETECTED - Gesture status: cooldown
💧 DRINKING DETECTED - Gesture status: in_progress
💧 DRINKING DETECTED - Gesture status: completed
```

**Console Details**:
```javascript
Rule: drinking_single_gesture_with_cup
Hand to mouth: 0.200
Cup visible: true
Detected objects: ["cup"]
Gesture status: completed
```

**Pass Criteria**:
- ✅ Single gesture detected
- ✅ Confidence 0.94
- ✅ Cup object recognized
- ✅ Gesture duration 100-800ms
- ❌ Repeated oscillation: Might confuse with eating
- ❌ Hand to mouth without cup: NOT drinking

---

### 🛏️ SLEEPING Test
**Expected**: Unchanged (still needs bed)

```
Step 1: Lie down on bed
  ↓
Expected:
Activity: Sleeping
Confidence: 0.95

Step 2: Lie down on floor/couch (no bed visible)
  ↓
Expected:
Activity: Sitting / rest
Confidence: 0.50 (fallback)
Reason: Bed not detected
```

---

### 🪑 SITTING Test
**Expected**: Chair optional but improves confidence

```
Step 1: Sit on chair
  ↓
Expected:
Activity: Sitting / rest
Confidence: 0.92

Step 2: Sit on floor/ground
  ↓
Expected:
Activity: Sitting / rest
Confidence: 0.65
```

---

## Troubleshooting

### Issue: Walking Not Detected
```
Symptom: Walking but shows "Sitting / rest"
Cause: Velocity too low or person not upright
Fix: 
  1. Walk faster (need velocity > 0.010)
  2. Stand straighter (bodyHeight > 0.50)
  3. Adjust WALKING_VELOCITY_THRESHOLD lower if needed
```

### Issue: Eating Detected Once, Then Stops
```
Symptom: First oscillation detected, then stops
Cause: Reset happens if no eating for 3 seconds
Fix:
  1. Keep eating motion continuous
  2. Multiple cycles in rapid succession
  3. No long pauses between bites
```

### Issue: Drinking Misdetected as Eating
```
Symptom: Drinking shows as eating
Cause: Repeated cup-to-mouth looks like eating oscillation
Fix:
  1. Drinking should be single motion, not repeated
  2. If repeated sips: Wait for gesture to complete
  3. Pause between sips (let cooldown finish)
```

### Issue: Food/Cup Not Detected
```
Symptom: "Eating" or "Drinking" shows but with low confidence
Cause: COCO-SSD object detector missing object
Fix:
  1. Make sure object is clearly visible in camera
  2. Move object into frame if partially cut off
  3. Better lighting may help detection
  4. Check console for detected objects list
```

---

## Console Debug Checklist

Open F12 Console and check for these messages:

```javascript
// WALKING detected properly?
✓ 🚶 WALKING DETECTED - Velocity: ...
✓ Rule: walking_velocity_based
✓ is_moving: true
✓ is_upright: true

// EATING detected properly?
✓ 🍽️  EATING DETECTED - Oscillation cycles: 2+
✓ Rule: eating_repeated_oscillation_with_food
✓ food_visible: true
✓ oscillation_cycles: >= 2

// DRINKING detected properly?
✓ 💧 DRINKING DETECTED - Gesture status: completed
✓ Rule: drinking_single_gesture_with_cup
✓ cup_visible: true
✓ gesture_duration_ms: 100-800

// SLEEPING detected properly?
✓ Rule: sleeping_horizontal_on_bed
✓ bed_detected: true
✓ body_horizontal: true

// SITTING detected properly?
✓ Rule: sitting_on_chair or sitting_posture_but_no_chair
✓ sitting_posture: true
```

---

## Metrics to Check

For each activity, verify:

1. **Correct Rule Triggered**
   - Check console for rule name
   - Eating should show "eating_repeated_oscillation..."
   - Drinking should show "drinking_single_gesture..."
   - Walking should show "walking_velocity_based"

2. **Confidence Level**
   - Walking: 0.65-0.95 (velocity dependent)
   - Eating: 0.90-0.96 (cycle dependent)
   - Drinking: 0.94 (consistent)
   - Sleeping: 0.95 (highest)
   - Sitting: 0.50-0.92 (chair dependent)

3. **Object Detection**
   - Check "detected_objects" array
   - Walking: No objects required
   - Eating: Should show ["plate"], ["fork"], etc.
   - Drinking: Should show ["cup"], ["bottle"], etc.
   - Sleeping: Should show "bed_detected: true"
   - Sitting: Should show "chair_detected" (high conf) or not (low conf)

4. **Pattern Indicators**
   - Eating: "oscillation_cycles: N" should increase
   - Drinking: "gesture_status" changes: started→in_progress→completed
   - Walking: "body_velocity: X.XXXX" shows movement

---

## Real-World Test Scenarios

### Scenario 1: Morning Routine
```
1. Wake up, lie on bed
   → Sleeping (0.95)
2. Get up, stand and walk to kitchen
   → Walking (0.85-0.95 as you move)
3. Stand at kitchen counter (stationary)
   → Sitting / rest (0.50)
4. Eat breakfast from plate
   → Eating (0.96)
5. Drink coffee from cup
   → Drinking (0.94)
6. Sit on chair
   → Sitting / rest (0.92)
```

### Scenario 2: Activity Confusion Prevention
```
1. Scratch face (no food)
   Expected: Sitting / rest (NOT Eating ✓)
   Because: No repeated oscillation or no food detected

2. Hold cup without drinking
   Expected: Sitting / rest (NOT Drinking ✓)
   Because: No hand-to-mouth gesture

3. Lying on floor
   Expected: Sitting / rest (NOT Sleeping ✓)
   Because: Bed not detected

4. Sitting and waving arms
   Expected: Sitting / rest (NOT Walking ✓)
   Because: Body velocity < 0.010 threshold
```

---

## Performance Checklist

- [ ] No lag in video feed
- [ ] Activity detection updates within 1 second
- [ ] Console output shows 30+ FPS pose detection
- [ ] Object detection runs smoothly (every 2nd frame)
- [ ] Temporal patterns tracked smoothly (no stuttering)

---

## Success Criteria

### All Activities Detected
- ✅ Walking: Fast + natural motion = 0.85-0.95
- ✅ Eating: Repeated cycles with food = 0.96
- ✅ Drinking: Single gesture with cup = 0.94
- ✅ Sleeping: On bed, horizontal = 0.95
- ✅ Sitting: On chair/floor = 0.92/0.65

### No False Positives
- ✅ Scratch face ≠ Eating
- ✅ Hold cup ≠ Drinking
- ✅ Lie on floor ≠ Sleeping
- ✅ Sit with arms up ≠ Walking
- ✅ Wave hands while sitting ≠ Walking

### Temporal Patterns Working
- ✅ Eating oscillation counter increments
- ✅ Drinking gesture state machine progresses
- ✅ Walking velocity responds to movement
- ✅ Patterns reset after inactivity

---

## Next Steps

After testing:

1. **Threshold Tuning**
   - If activity not detected: Adjust WALKING_VELOCITY_THRESHOLD, EATING_MIN_CYCLES
   - If false positives: Raise thresholds

2. **Object Detection Improvement**
   - If food/cup not detected: Check lighting, object position
   - Consider adding more object types if needed

3. **Production Deployment**
   - Deploy to server when all tests pass
   - Monitor real-world accuracy
   - Collect feedback for further tuning

---

**Testing Date**: [Fill in]  
**Tester**: [Fill in]  
**Results**: [Pass/Fail]  
**Notes**: [Any issues or observations]  

