import { useContext } from 'react';
import { MonitoringContext } from './MonitoringProvider.jsx';
import { DEFAULT_POLICY } from './policy.js';

const INERT = {
  status: { fullscreen: false, online: true, queued: 0, lastUploadAt: null, blocked: false },
  blocked: false, reason: null, policy: DEFAULT_POLICY,
  lastWarning: null, lastWarningType: null, warningSeq: 0, eventCount: 0,
  enterFullscreen: async () => false, report: () => {}, flush: async () => true, finalize: async () => {},
};

// Provider ke bahar chalaye toh inert default (crash nahi).
export function useExamMonitoring() {
  return useContext(MonitoringContext) || INERT;
}
