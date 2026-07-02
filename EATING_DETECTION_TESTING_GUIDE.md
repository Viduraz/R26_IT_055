# Eating Detection Testing & Validation Guide

## Overview
This guide helps you validate and test the eating detection algorithm against:
1. **Simulated scenarios** (synthetic pose data)
2. **Real eating videos** (manual or automated testing)
3. **Live webcam testing** (real-time validation)

## Part 1: Automated Test Suite

### Test File
- **Location:** `test_eating_detection.js`
- **Contains:** 6 detailed eating scenarios with expected results

### Test Scenarios

#### Scenario 1: Close-up Eating (1m distance)
- **Setup:** Person at 1m from camera eating with spoon
- **Objects:** Spoon, bowl visible
- **Expected:** ✅ Eating detected (confidence ≥ 0.75)
- **Test:** Hand moves from table to mouth with spoon visible

#### Scenario 2: Far-away Eating (3m distance)
- **Setup:** Person at 3m distance eating with fork
- **Objects:** Fork, plate, dining table visible
- **Expected:** ✅ Eating detected (confidence ≥ 0.75)
- **Test:** Subtle hand movements with plate recognition

#### Scenario 3: Hand Eating (Pizza/Sandwich)
- **Setup:** Person eating without utensil
- **Objects:** Pizza/sandwich object detected
- **Expected:** ✅ Eating detected (confidence ≥ 0.75)
- **Test:** Hand directly at mouth with food

#### Scenario 4: False Positive Test (Scratching)
- **Setup:** Person scratching face (NOT eating)
- **Objects:** No food visible
- **Expected:** ❌ NOT Eating (confidence = 0.0)
- **Test:** Hand off to the side, no food objects

#### Scenario 5: Both Hands Eating (Fruit)
- **Setup:** Person eating fruit with both hands
- **Objects:** Apple/fruit detected
- **Expected:** ✅ Eating detected (confidence ≥ 0.75)
- **Test:** Both hands involved in eating motion

#### Scenario 6: Continuous Sequence (3 frames)
- **Setup:** Realistic eating sequence
- **Objects:** Fork, plate visible throughout
- **Expected:** ✅ Eating detected in frames 2-3
- **Test:** Plate → mouth → plate motion

### Running Tests

#### Option A: Browser Console
1. Open the app in browser
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Run:
```javascript
testEatingDetection(classifyActivity, calculateWristToMouthDistance)
```

**Expected Output:**
```
🧪 EATING ACTIVITY DETECTION TEST SUITE
=====================================

📸 SCENARIO: Close-up Eating (1m distance)
   Description: Person eating with spoon, utensil near mouth
   ─────────────────────────────────

   Frame 1:
   - Hand-to-mouth distance: 0.045
   - Objects detected: spoon, bowl
   - Chewing: Yes
   - Detected activity: Eating
   - Confidence: 0.85
   ✓ Expected: Eating → ✅ PASS

...

📊 TEST SUMMARY
=====================================

✅ Close-up Eating (1m distance)
✅ Far-away Eating (3m distance)
✅ Hand Eating (Pizza/Sandwich)
✅ False Positive - Face Scratching
✅ Both Hands Eating (Apple/Fruit)
✅ Continuous Eating Sequence

Total: 6/6 scenarios passed
Success rate: 100%
```

#### Option B: Node.js Testing
1. Create a test runner file
2. Import the test suite
3. Run with Node

## Part 2: Real Video Testing

### Setup Real Eating Videos

**Video requirements:**
- Format: MP4, WebM
- Resolution: 640x480 or higher
- Duration: 10-30 seconds per video
- Frame rate: 30 FPS

### Creating Test Videos

#### Option 1: Record Your Own
1. Use smartphone camera
2. Record eating activities:
   - Eating with spoon/fork
   - Eating with hand (sandwich, fruit)
   - Various distances (1m, 2m, 3m)
3. Save to: `schedule-monitoring/frontend/public/test-videos/`

#### Option 2: Find Sample Videos Online
- Search: "eating activity video" on YouTube/Pexels
- Download using: `youtube-dl` or similar
- Save in test-videos folder

### Test Video Examples

Create these test videos:

| Video Name | Activity | Duration | Expected |
|-----------|----------|----------|----------|
| `eating_fork_spoon.mp4` | Eating with fork/spoon | 15s | ✅ Eating |
| `eating_hand.mp4` | Eating with hand | 15s | ✅ Eating |
| `eating_far_3m.mp4` | Eating at 3m distance | 15s | ✅ Eating |
| `false_scratching.mp4` | Scratching face | 10s | ❌ Not Eating |
| `false_gesture.mp4` | Hand gestures (not eating) | 10s | ❌ Not Eating |
| `eating_continuous.mp4` | Continuous eating (plate→mouth) | 20s | ✅ Eating |

## Part 3: Live Webcam Testing

### Quick Manual Test

1. **Start the app:**
   ```bash
   cd schedule-monitoring/frontend
   npm run dev
   ```

2. **Open localhost:5177 in browser**

3. **Start Detection:**
   - Click "Dashboard"
   - Click "Start Detection"
   - Allow camera access

4. **Perform Eating Activity:**
   - Simulate eating with spoon/fork
   - Move hand to mouth with food object visible
   - Perform for 3+ seconds (confirmation threshold)

5. **Verify Results:**
   - Check detected activity (should show "Eating")
   - Check confidence score (should be 0.75+)
   - Check schedule if logged after 3 seconds

### Test Checklist

Run through each scenario:

```
CLOSE-UP EATING (1m)
[ ] Have visible food/utensil (spoon, fork, plate)
[ ] Move hand to mouth slowly
[ ] Hold for 3+ seconds
[ ] Expected: ✅ Eating detected with 75-98% confidence

FAR-AWAY EATING (3m)
[ ] Step back ~3 meters from camera
[ ] Have visible plate/dining table
[ ] Subtle eating motion
[ ] Expected: ✅ Eating detected with 75%+ confidence

HAND EATING
[ ] No utensil visible
[ ] Hand visible with food object detected
[ ] Move hand to mouth
[ ] Expected: ✅ Eating detected

FALSE POSITIVE CHECK
[ ] Scratch face (no food visible)
[ ] Expected: ❌ NOT Eating / Sitting

CONTINUOUS MOTION
[ ] Pick up food → move to mouth → put down
[ ] Full sequence 3+ seconds
[ ] Expected: ✅ Eating throughout motion
```

## Part 4: Debugging & Analysis

### Console Logs

In the browser console, you'll see:
```javascript
✓ Activity Detected: Eating
  Confidence: 0.87
  Hand-to-mouth: 0.048 ✅ (< 0.55)
  Food Objects: spoon, plate ✅
  Chewing: true ✅
  Motion: wrist_trajectory ✅
```

### Common Issues & Fixes

#### Issue 1: Not Detecting Eating
**Symptoms:** Shows "Sitting/rest" instead of "Eating"

**Causes & Fixes:**
- ❌ Food not detected by COCO-SSD
  - **Fix:** Ensure plate/utensil is clearly visible
- ❌ Hand too far from mouth
  - **Fix:** Move hand closer (< 0.48 normalized distance)
- ❌ Moving too fast (velocity > 0.10)
  - **Fix:** Slow down eating motion
- ❌ No objects detected
  - **Fix:** Lighting should be good, position food in center

#### Issue 2: False Positives (Scratching detected as eating)
**Symptoms:** Face scratching shows "Eating"

**Causes & Fixes:**
- ❌ Object detector picking up false positives
  - **Fix:** Make sure no food/spoon in frame when scratching
- ❌ Threshold too lenient
  - **Fix:** Verify `handToMouth < 0.48` in code

#### Issue 3: Far-away eating not detected
**Symptoms:** At 3m distance, eating not detected

**Causes & Fixes:**
- ❌ Pose detection confidence too low
  - **Fix:** Ensure good lighting
- ❌ Object detection missing plate
  - **Fix:** Ensure plate/table is visible and large enough
- ❌ Hand-to-mouth calculation off
  - **Fix:** Verify `calculateWristToMouthDistance()` is being called

### Debug Console Commands

```javascript
// Check current hand-to-mouth distance
console.log("Hand-to-mouth:", minHandToMouth);

// Check detected objects
console.log("Objects:", lastDetectedObjects);

// Check activity detection signals
console.log("Signals:", signals);

// Check wrist history
console.log("Wrist history:", wristPositionHistory);

// Detailed activity check
if (activity === "Eating") {
  console.log("✅ Eating detected!");
  console.log("- Confidence:", confidence);
  console.log("- Food visible:", hasFoodOrBowl);
  console.log("- Hand-to-mouth:", handToMouth.toFixed(3));
} else {
  console.log("❌ Not eating, detected:", activity);
}
```

## Part 5: Expected Results by Scenario

### Success Criteria

| Scenario | Confidence | Key Indicators |
|----------|-----------|-----------------|
| **Close-up eating** | 0.85-0.98 | Food visible + hand at mouth + chewing |
| **Far-away eating** | 0.75-0.92 | Plate visible + subtle motion + alignment |
| **Hand eating** | 0.75-0.85 | Hand at mouth + food object + no utensil |
| **False positive rejection** | 0.0 | No food objects + hand off to side |
| **Continuous motion** | 0.75+ per frame | Consistent detection across frames |

### Performance Benchmarks

After implementation, you should see:

```
Close-up Eating (1m):
- Detection latency: < 100ms
- Confidence range: 0.85-0.98
- False positive rate: < 2%

Far-away Eating (3m):
- Detection latency: 100-200ms (subtle motion)
- Confidence range: 0.75-0.92
- False positive rate: < 5%

Overall:
- True positive rate: > 95%
- False positive rate: < 5%
- Average latency: < 150ms
```

## Part 6: Comparison with Dataset

### If You Have Eating Videos

1. **Create a comparison script:**
   ```javascript
   // Compare ground truth vs detected
   const videoFile = "eating_with_fork.mp4";
   const groundTruth = { activity: "Eating", timeRange: [0, 15] };
   
   // Run detection and compare
   ```

2. **Log results:**
   ```
   Video: eating_with_fork.mp4
   Ground Truth: Eating (0-15s)
   Detected: Eating (0.5-14.8s)
   ✅ CORRECT - Detection 0.5s latency, 0.2s margin of error
   ```

## Summary

Your eating detection system should now:
✅ Detect eating from 1-3m distances
✅ Work with utensils, hands, and various foods
✅ Reject false positives (scratching, gestures)
✅ Maintain 3-second confirmation before logging
✅ Achieve > 95% true positive rate

Use these tests to validate all scenarios are working correctly!
