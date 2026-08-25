/**
 * EATING ACTIVITY DETECTION TEST SUITE
 * 
 * This script tests the eating detection algorithm against simulated eating scenarios
 * Scenarios based on real-world eating patterns
 */

// ============================================================================
// EATING SCENARIO SIMULATOR
// ============================================================================

/**
 * Test Scenario 1: Close-up eating with spoon
 * Person at ~1m from camera, eating with spoon
 */
const scenario1_closeupEating = {
  name: "Close-up Eating (1m distance)",
  description: "Person eating with spoon, utensil near mouth",
  frames: [
    // Frame 1: Hand moving toward mouth
    {
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.95 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.92 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.92 },
        leftElbow: { x: 0.30, y: 0.55, score: 0.88 },
        rightElbow: { x: 0.70, y: 0.55, score: 0.88 },
        leftWrist: { x: 0.48, y: 0.32, score: 0.90 },  // ← Moving toward mouth
        rightWrist: { x: 0.52, y: 0.38, score: 0.85 },
        leftHip: { x: 0.35, y: 0.65, score: 0.85 },
        rightHip: { x: 0.65, y: 0.65, score: 0.85 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.80 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.80 }
      },
      objects: [
        { class: 'spoon', score: 0.92, bbox: [0.46, 0.28, 0.08, 0.12] },
        { class: 'bowl', score: 0.85, bbox: [0.40, 0.60, 0.20, 0.15] }
      ],
      isChewing: true,
      expectedActivity: "Eating",
      expectedConfidence: ">= 0.75"
    },
    // Frame 2: Hand at mouth
    {
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.95 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.92 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.92 },
        leftElbow: { x: 0.30, y: 0.52, score: 0.88 },
        rightElbow: { x: 0.70, y: 0.52, score: 0.88 },
        leftWrist: { x: 0.49, y: 0.30, score: 0.91 },  // ← At mouth level
        rightWrist: { x: 0.51, y: 0.36, score: 0.86 },
        leftHip: { x: 0.35, y: 0.65, score: 0.85 },
        rightHip: { x: 0.65, y: 0.65, score: 0.85 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.80 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.80 }
      },
      objects: [
        { class: 'spoon', score: 0.94, bbox: [0.47, 0.26, 0.08, 0.12] },
        { class: 'bowl', score: 0.87, bbox: [0.40, 0.60, 0.20, 0.15] }
      ],
      isChewing: true,
      expectedActivity: "Eating",
      expectedConfidence: ">= 0.85"
    }
  ]
};

/**
 * Test Scenario 2: Far-away eating with plate
 * Person at ~3m from camera, eating with fork
 */
const scenario2_farAwayEating = {
  name: "Far-away Eating (3m distance)",
  description: "Person eating with fork from far away, plate visible",
  frames: [
    {
      pose: {
        nose: { x: 0.5, y: 0.40, score: 0.88 },
        leftShoulder: { x: 0.38, y: 0.50, score: 0.85 },
        rightShoulder: { x: 0.62, y: 0.50, score: 0.85 },
        leftElbow: { x: 0.35, y: 0.58, score: 0.80 },
        rightElbow: { x: 0.65, y: 0.58, score: 0.80 },
        leftWrist: { x: 0.48, y: 0.35, score: 0.78 },  // ← Subtle hand position
        rightWrist: { x: 0.52, y: 0.42, score: 0.75 },
        leftHip: { x: 0.38, y: 0.70, score: 0.78 },
        rightHip: { x: 0.62, y: 0.70, score: 0.78 },
        leftAnkle: { x: 0.38, y: 0.95, score: 0.72 },
        rightAnkle: { x: 0.62, y: 0.95, score: 0.72 }
      },
      objects: [
        { class: 'fork', score: 0.89, bbox: [0.46, 0.32, 0.06, 0.14] },
        { class: 'plate', score: 0.91, bbox: [0.35, 0.60, 0.30, 0.25] },
        { class: 'dining table', score: 0.85, bbox: [0.20, 0.75, 0.60, 0.20] }
      ],
      isChewing: true,
      expectedActivity: "Eating",
      expectedConfidence: ">= 0.75"
    }
  ]
};

/**
 * Test Scenario 3: Eating with hand (no utensil)
 * Person eating pizza/sandwich with hand
 */
const scenario3_handEating = {
  name: "Hand Eating (Pizza/Sandwich)",
  description: "Person eating with hand, no utensil",
  frames: [
    {
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.94 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.91 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.91 },
        leftElbow: { x: 0.30, y: 0.52, score: 0.87 },
        rightElbow: { x: 0.70, y: 0.52, score: 0.87 },
        leftWrist: { x: 0.47, y: 0.31, score: 0.89 },  // ← Hand at mouth
        rightWrist: { x: 0.53, y: 0.37, score: 0.84 },
        leftHip: { x: 0.35, y: 0.65, score: 0.84 },
        rightHip: { x: 0.65, y: 0.65, score: 0.84 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.79 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.79 }
      },
      objects: [
        { class: 'pizza', score: 0.90, bbox: [0.45, 0.28, 0.10, 0.12] },
        { class: 'plate', score: 0.88, bbox: [0.30, 0.55, 0.40, 0.20] }
      ],
      isChewing: true,
      expectedActivity: "Eating",
      expectedConfidence: ">= 0.75"
    }
  ]
};

/**
 * Test Scenario 4: FALSE POSITIVE - Scratching face (not eating)
 * Person scratching/rubbing face
 */
const scenario4_falseFaceTouch = {
  name: "False Positive - Face Scratching",
  description: "Person scratching face (should NOT be eating)",
  frames: [
    {
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.92 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.89 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.89 },
        leftElbow: { x: 0.25, y: 0.50, score: 0.85 },  // ← Elbow raised high (scratching)
        rightElbow: { x: 0.75, y: 0.48, score: 0.85 },
        leftWrist: { x: 0.20, y: 0.38, score: 0.88 },  // ← Off to the side (not aligned with mouth)
        rightWrist: { x: 0.80, y: 0.40, score: 0.87 },
        leftHip: { x: 0.35, y: 0.65, score: 0.82 },
        rightHip: { x: 0.65, y: 0.65, score: 0.82 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.77 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.77 }
      },
      objects: [],  // No food objects
      isChewing: false,
      expectedActivity: "NOT Eating",
      expectedConfidence: "0.0"
    }
  ]
};

/**
 * Test Scenario 5: Eating with both hands (fruit/apple)
 * Person eating apple/fruit with both hands
 */
const scenario5_bothHandsEating = {
  name: "Both Hands Eating (Apple/Fruit)",
  description: "Person eating fruit, both hands involved",
  frames: [
    {
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.93 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.90 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.90 },
        leftElbow: { x: 0.32, y: 0.50, score: 0.86 },
        rightElbow: { x: 0.68, y: 0.50, score: 0.86 },
        leftWrist: { x: 0.46, y: 0.33, score: 0.88 },  // ← Left hand at mouth
        rightWrist: { x: 0.54, y: 0.34, score: 0.89 },  // ← Right hand at mouth
        leftHip: { x: 0.35, y: 0.65, score: 0.83 },
        rightHip: { x: 0.65, y: 0.65, score: 0.83 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.78 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.78 }
      },
      objects: [
        { class: 'apple', score: 0.92, bbox: [0.44, 0.30, 0.12, 0.12] }
      ],
      isChewing: true,
      expectedActivity: "Eating",
      expectedConfidence: ">= 0.75"
    }
  ]
};

/**
 * Test Scenario 6: Continuous eating sequence (3 frames)
 * Realistic eating motion: plate → mouth → back to plate
 */
const scenario6_continuousEating = {
  name: "Continuous Eating Sequence",
  description: "3-frame sequence of eating motion (plate → mouth → plate)",
  frames: [
    {
      frameNum: 1,
      description: "Hand at plate",
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.95 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.93 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.93 },
        leftElbow: { x: 0.30, y: 0.58, score: 0.90 },
        rightElbow: { x: 0.70, y: 0.58, score: 0.90 },
        leftWrist: { x: 0.48, y: 0.60, score: 0.92 },  // ← Hand at plate level
        rightWrist: { x: 0.52, y: 0.62, score: 0.88 },
        leftHip: { x: 0.35, y: 0.65, score: 0.87 },
        rightHip: { x: 0.65, y: 0.65, score: 0.87 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.82 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.82 }
      },
      objects: [
        { class: 'fork', score: 0.93, bbox: [0.46, 0.58, 0.08, 0.10] },
        { class: 'plate', score: 0.94, bbox: [0.35, 0.55, 0.30, 0.20] }
      ],
      isChewing: false
    },
    {
      frameNum: 2,
      description: "Hand moving toward mouth (mid-motion)",
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.95 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.93 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.93 },
        leftElbow: { x: 0.30, y: 0.50, score: 0.91 },
        rightElbow: { x: 0.70, y: 0.50, score: 0.91 },
        leftWrist: { x: 0.48, y: 0.42, score: 0.93 },  // ← Hand rising toward mouth
        rightWrist: { x: 0.52, y: 0.48, score: 0.89 },
        leftHip: { x: 0.35, y: 0.65, score: 0.87 },
        rightHip: { x: 0.65, y: 0.65, score: 0.87 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.82 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.82 }
      },
      objects: [
        { class: 'fork', score: 0.94, bbox: [0.46, 0.40, 0.08, 0.10] },
        { class: 'plate', score: 0.92, bbox: [0.35, 0.55, 0.30, 0.20] }
      ],
      isChewing: false
    },
    {
      frameNum: 3,
      description: "Hand at mouth",
      pose: {
        nose: { x: 0.5, y: 0.35, score: 0.95 },
        leftShoulder: { x: 0.35, y: 0.45, score: 0.93 },
        rightShoulder: { x: 0.65, y: 0.45, score: 0.93 },
        leftElbow: { x: 0.30, y: 0.45, score: 0.91 },
        rightElbow: { x: 0.70, y: 0.45, score: 0.91 },
        leftWrist: { x: 0.49, y: 0.32, score: 0.94 },  // ← Hand at mouth
        rightWrist: { x: 0.51, y: 0.38, score: 0.90 },
        leftHip: { x: 0.35, y: 0.65, score: 0.87 },
        rightHip: { x: 0.65, y: 0.65, score: 0.87 },
        leftAnkle: { x: 0.35, y: 0.95, score: 0.82 },
        rightAnkle: { x: 0.65, y: 0.95, score: 0.82 }
      },
      objects: [
        { class: 'fork', score: 0.95, bbox: [0.47, 0.30, 0.08, 0.10] },
        { class: 'plate', score: 0.93, bbox: [0.35, 0.55, 0.30, 0.20] }
      ],
      isChewing: true
    }
  ]
};

// ============================================================================
// TEST RUNNER
// ============================================================================

export const eatingTestScenarios = [
  scenario1_closeupEating,
  scenario2_farAwayEating,
  scenario3_handEating,
  scenario4_falseFaceTouch,
  scenario5_bothHandsEating,
  scenario6_continuousEating
];

/**
 * Run test suite and report results
 * 
 * Usage in console:
 * 1. Import this file
 * 2. Call: testEatingDetection(classifyActivity, calculateWristToMouthDistance)
 */
export function testEatingDetection(classifyActivityFn, calculateDistanceFn) {
  console.log("🧪 EATING ACTIVITY DETECTION TEST SUITE\n");
  console.log("=====================================\n");

  const results = [];

  for (const scenario of eatingTestScenarios) {
    console.log(`\n📸 SCENARIO: ${scenario.name}`);
    console.log(`   Description: ${scenario.description}`);
    console.log("   ─────────────────────────────────");

    let scenarioPass = true;

    for (let i = 0; i < scenario.frames.length; i++) {
      const frame = scenario.frames[i];
      const frameLabel = scenario.frames.length > 1 ? `Frame ${frame.frameNum || i + 1}` : "Frame 1";

      // Extract pose keypoints
      const keypoints = Object.keys(frame.pose).reduce((acc, key) => {
        acc[key] = frame.pose[key];
        return acc;
      }, {});

      // Calculate features (simplified version)
      const mouthX = frame.pose.nose.x;
      const mouthY = frame.pose.nose.y;

      // Calculate hand-to-mouth distance
      const leftWristDist = calculateDistanceFn(frame.pose.leftWrist, mouthX, mouthY, frame.pose.nose);
      const rightWristDist = calculateDistanceFn(frame.pose.rightWrist, mouthX, mouthY, frame.pose.nose);
      const handToMouth = Math.min(leftWristDist, rightWristDist);

      // Calculate velocity (simplified)
      const velocity = 0.05;

      // Call classification
      const result = classifyActivityFn(
        [
          1.0, 0.5, 0.5, 0.5, 0.5,  // Body measurements
          0.8,
          0.2,
          handToMouth,               // Hand-to-mouth (our key metric)
          velocity,
          0.1, 0.2, 0.5, 0.3, 0.1, 0.1  // Other features
        ],
        [keypoints],
        0.2,
        frame.objects,
        frame.isChewing,
        0  // chewingCycles
      );

      console.log(`\n   ${frameLabel}:`);
      if (frame.description) console.log(`   ${frame.description}`);
      console.log(`   - Hand-to-mouth distance: ${handToMouth.toFixed(3)}`);
      console.log(`   - Objects detected: ${frame.objects.map(o => o.class).join(", ") || "None"}`);
      console.log(`   - Chewing: ${frame.isChewing ? "Yes" : "No"}`);
      console.log(`   - Detected activity: ${result ? result.activity : "None"}`);
      console.log(`   - Confidence: ${result ? result.confidence.toFixed(2) : "0.00"}`);

      if (frame.expectedActivity) {
        const isCorrect = result && result.activity === frame.expectedActivity;
        console.log(`   ✓ Expected: ${frame.expectedActivity} → ${isCorrect ? "✅ PASS" : "❌ FAIL"}`);
        if (!isCorrect) scenarioPass = false;
      }
    }

    results.push({
      scenario: scenario.name,
      passed: scenarioPass
    });
  }

  // Summary
  console.log("\n\n=====================================");
  console.log("📊 TEST SUMMARY");
  console.log("=====================================\n");

  const passCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  for (const result of results) {
    console.log(`${result.passed ? "✅" : "❌"} ${result.scenario}`);
  }

  console.log(`\nTotal: ${passCount}/${totalCount} scenarios passed`);
  console.log(`Success rate: ${((passCount / totalCount) * 100).toFixed(0)}%\n`);

  return {
    passed: passCount,
    total: totalCount,
    successRate: (passCount / totalCount) * 100
  };
}

// ============================================================================
// CONSOLE LOG HELPER
// ============================================================================

console.log(`
✅ Eating Detection Test Suite Loaded!

To run tests, open browser console and run:
testEatingDetection(classifyActivity, calculateWristToMouthDistance)

Expected output: 6 test scenarios with pass/fail results
`);
