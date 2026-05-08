/**
 * gateway-dashboard/frontend/src/components/CameraPreview.jsx
 *
 * Upgraded reusable webcam preview component.
 * Supports:
 *   - live webcam stream via react-webcam
 *   - ref forwarding so parent can call .getScreenshot()
 *   - optional mirroring (default: true for selfie view)
 *   - error callback for permission denied
 *   - configurable constraints
 */

import { forwardRef } from 'react';
import Webcam from 'react-webcam';

const CameraPreview = forwardRef(function CameraPreview(
  {
    mirrored = true,
    onError,
    className = '',
    videoConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user',
    },
    screenshotFormat = 'image/jpeg',
  },
  ref
) {
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-black ${className}`}>
      <Webcam
        ref={ref}
        audio={false}
        screenshotFormat={screenshotFormat}
        videoConstraints={videoConstraints}
        onUserMediaError={onError}
        className="w-full h-full object-cover"
        style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
      />
    </div>
  );
});

export default CameraPreview;
