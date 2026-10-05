import { useExamMonitoring } from './useExamMonitoring.js';
import { isFullscreenSupported } from './monitors/fullscreenMonitor.js';

// Fullscreen se bahar ho toh re-enter button. Exam block nahi hota (policy-permitted mode me chalta rahe).
export default function FullscreenBanner() {
  const { policy, status, enterFullscreen } = useExamMonitoring();
  if (!policy.fullscreen || status.fullscreen || status.blocked || !isFullscreenSupported()) return null;
  return (
    <div className="fullscreen-banner" role="status">
      <span>This exam is meant to run in fullscreen.</span>
      <button type="button" onClick={() => enterFullscreen()}>Re-enter fullscreen</button>
    </div>
  );
}
