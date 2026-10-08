import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolvePolicy, WARNING_BY_EVENT, MESSAGES, STRICT_EVENTS } from './policy.js';
import { createEventFactory } from './events/eventFactory.js';
import { EventQueue } from './events/eventQueue.js';
import { openEventStore } from './events/indexedDbEventStore.js';
import { createEventUploader } from './events/eventUploader.js';
import { sendEvents as defaultSendEvents } from '../../api/eventApi.js';
import { createVisibilityMonitor } from './monitors/visibilityMonitor.js';
import { createFocusMonitor } from './monitors/focusMonitor.js';
import { createFullscreenMonitor, requestFullscreen } from './monitors/fullscreenMonitor.js';
import { createClipboardMonitor } from './monitors/clipboardMonitor.js';
import { createShortcutMonitor } from './monitors/shortcutMonitor.js';
import { createContextMenuMonitor } from './monitors/contextMenuMonitor.js';
import { createSelectionMonitor } from './monitors/selectionMonitor.js';
import { createNetworkMonitor } from './monitors/networkMonitor.js';
import { createHeartbeatMonitor, TERMINAL_STATUSES } from './monitors/heartbeatMonitor.js';
import { createPermissionMonitor } from './system-check/checkCamera.js';
import { onNativeEvent } from './nativeBridgeAdapter.js';

export const MonitoringContext = createContext(null);

// Duplicate guard: ek attempt par ek hi provider monitors chalayega.
const activeAttempts = new Map();

export function MonitoringProvider({ attemptId, policy, consentGiven, children, onServerTime, onAttemptStatus, deps }) {
  const resolved = useMemo(() => resolvePolicy(policy), [JSON.stringify(policy || {})]); // eslint-disable-line
  const blocked = resolved.requireConsent && !consentGiven;

  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [queued, setQueued] = useState(0);
  const [lastUploadAt, setLastUploadAt] = useState(null);
  const [warning, setWarning] = useState({ message: null, type: null, seq: 0 });
  const [eventCount, setEventCount] = useState(0);

  const sessionRef = useRef(null);
  const pendingRef = useRef([]);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const cbRef = useRef({});
  cbRef.current = { onServerTime, onAttemptStatus };
  const depsRef = useRef(deps || {});
  depsRef.current = deps || {};

  const report = useCallback((eventType, metadata = {}) => {
    if (blockedRef.current) return;
    const s = sessionRef.current;
    if (!s) { pendingRef.current.push([eventType, metadata]); return; }
    s.report(eventType, metadata);
  }, []);

  useEffect(() => {
    if (blocked || activeAttempts.has(attemptId)) return undefined;
    const token = Symbol('monitoring');
    activeAttempts.set(attemptId, token);
    let cancelled = false;
    let session = null;
    const cleanups = [];
    const p = resolved;

    (async () => {
      const d = depsRef.current;
      const store = d.store || (await openEventStore(attemptId));
      if (cancelled) return;
      const queue = new EventQueue(store);
      await queue.init();
      const last = await store.lastSequence();
      if (cancelled) return;
      const startSequence = Math.max(last, queue.items.length ? queue.items[queue.items.length - 1].clientSequence : 0) + 1;
      const factory = createEventFactory({ attemptId, startSequence });
      const uploader = createEventUploader({
        queue, attemptId, sendEvents: d.sendEvents || defaultSendEvents, ...(d.uploader || {}),
        onUploaded: (res) => {
          setLastUploadAt(new Date().toISOString());
          setQueued(queue.size());
          // Strict mode: server ne attempt submit kar diya => shell ko turant batao.
          if (res && TERMINAL_STATUSES.has(res.attemptStatus) && cbRef.current.onAttemptStatus) cbRef.current.onAttemptStatus(res.attemptStatus);
        },
      });

      let seq = 0;
      const rep = (eventType, metadata = {}) => {
        try {
          const meta = p.accessibilityMode ? { ...metadata, accessibilityMode: true } : metadata;
          const ev = factory.create(eventType, meta);
          const strict = p.autoSubmitOnViolation && STRICT_EVENTS.has(eventType);
          queue.add(ev).then(() => { setQueued(queue.size()); if (strict) uploader.flush(); else uploader.notify(); });
          if (WARNING_BY_EVENT[eventType]) {
            seq += 1;
            setWarning({ message: WARNING_BY_EVENT[eventType], type: eventType, seq });
            setEventCount((c) => c + 1);
          }
        } catch { /* invalid event — drop, monitor kabhi crash nahi karega */ }
      };

      const add = (c) => cleanups.push(c);
      if (p.visibility) add(createVisibilityMonitor(rep));
      if (p.focus) add(createFocusMonitor(rep));
      if (p.fullscreen) add(createFullscreenMonitor(rep, { onChange: setFullscreen }));
      if (p.clipboard) add(createClipboardMonitor(rep, { block: p.clipboard.block, allowInInputs: p.clipboard.allowInInputs, accessibilityMode: p.accessibilityMode }));
      if (p.shortcuts) add(createShortcutMonitor(rep, { allowInInputs: p.clipboard ? p.clipboard.allowInInputs : false, accessibilityMode: p.accessibilityMode }));
      if (p.contextMenu) add(createContextMenuMonitor(rep, { allowInInputs: p.clipboard ? p.clipboard.allowInInputs : false, accessibilityMode: p.accessibilityMode }));
      if (p.selection) add(createSelectionMonitor({ block: p.selection.block, accessibilityMode: p.accessibilityMode }));
      if (p.network) add(createNetworkMonitor(rep, { onChange: setOnline }));
      if (p.heartbeat) {
        add(createHeartbeatMonitor(rep, {
          attemptId, heartbeatFn: d.heartbeatFn, intervalMs: d.heartbeatIntervalMs,
          onServerTime: (...a) => cbRef.current.onServerTime && cbRef.current.onServerTime(...a),
          onAttemptStatus: (...a) => cbRef.current.onAttemptStatus && cbRef.current.onAttemptStatus(...a),
        }));
      }
      if (p.camera || p.microphone) add(createPermissionMonitor(rep, { camera: p.camera, microphone: p.microphone }));
      // Native client ke events bhi student ko same toast me dikhte hain.
      add(onNativeEvent((payload) => {
        const t = payload.eventType || payload.type;
        seq += 1;
        setWarning({ message: WARNING_BY_EVENT[t] || MESSAGES.generic, type: t || 'NATIVE_EVENT', seq });
        setEventCount((c) => c + 1);
      }));

      uploader.start();
      const stopMonitors = () => { while (cleanups.length) cleanups.pop()(); };
      session = {
        report: rep,
        flush: () => uploader.flush(),
        finalize: async () => { stopMonitors(); await uploader.flush(); uploader.stop(); },
        teardown: () => { stopMonitors(); uploader.stop(); uploader.flush(); },
      };
      sessionRef.current = session;
      setQueued(queue.size());
      pendingRef.current.splice(0).forEach(([t, m]) => rep(t, m));
    })();

    return () => {
      cancelled = true;
      if (activeAttempts.get(attemptId) === token) activeAttempts.delete(attemptId);
      if (session) session.teardown();
      else while (cleanups.length) cleanups.pop()();
      sessionRef.current = null;
    };
  }, [attemptId, resolved, blocked]);

  const enterFullscreen = useCallback(() => (blockedRef.current ? Promise.resolve(false) : requestFullscreen()), []);
  const flush = useCallback(async () => (sessionRef.current ? sessionRef.current.flush() : true), []);
  const finalize = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = { report: () => {}, flush: async () => true, finalize: async () => {}, teardown: () => {} };
    await s.finalize();
  }, []);

  const value = useMemo(() => ({
    status: { fullscreen, online, queued, lastUploadAt, blocked },
    blocked,
    reason: blocked ? 'CONSENT_REQUIRED' : null,
    policy: resolved,
    lastWarning: warning.message,
    lastWarningType: warning.type,
    warningSeq: warning.seq,
    eventCount,
    enterFullscreen,
    report,
    flush,
    finalize,
  }), [fullscreen, online, queued, lastUploadAt, blocked, resolved, warning, eventCount, enterFullscreen, report, flush, finalize]);

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
}
