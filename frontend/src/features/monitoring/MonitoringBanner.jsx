import { MESSAGES } from './policy.js';
import { useExamMonitoring } from './useExamMonitoring.js';

export default function MonitoringBanner() {
  const { status } = useExamMonitoring();
  if (status.blocked) {
    return <div className="monitoring-banner monitoring-banner--blocked" role="status">Monitoring consent is required to start the exam.</div>;
  }
  return <div className="monitoring-banner" role="status">{MESSAGES.banner}</div>;
}
