import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, onAccessTokenChange } from '../../auth/useAuth.js';
import { saveAnswer, submit, heartbeat } from '../../api/attemptApi.js';
import { useAutosave } from '../../hooks/useAutosave.js';
import { useTimer } from '../../hooks/useTimer.js';
import { useServerClock } from '../../hooks/useServerClock.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import QuestionCard from './QuestionCard.jsx';
import { isAnswered } from './QuestionNavigator.jsx';
import { MonitoringProvider } from '../monitoring/MonitoringProvider.jsx';
import { useExamMonitoring } from '../monitoring/useExamMonitoring.js';
import { resolvePolicy, STRICT_EVENTS } from '../monitoring/policy.js';
import { isNativeClient, bindNativeClient } from '../monitoring/nativeBridgeAdapter.js';
import { TERMINAL_STATUSES, terminalStatusFromError } from '../monitoring/monitors/heartbeatMonitor.js';
import { useOfflineRecovery } from '../monitoring/useOfflineRecovery.js';
import FullscreenBanner from '../monitoring/FullscreenBanner.jsx';
import WarningToast from '../monitoring/WarningToast.jsx';
import AccessibilityNotice from '../monitoring/AccessibilityNotice.jsx';
import StatusBar from './StatusBar.jsx';

export const AUTO_SUBMIT_ARM_MS = 1500;   // mount ke turant baad ke transitions ignore
const AUTO_REASON = { FULLSCREEN_EXIT: 'you left fullscreen', PAGE_HIDDEN: 'you switched tab or minimised the window', WINDOW_BLUR: 'the exam window lost focus' };

function ExamShellInner({ attempt, policy, expiresAt, clock, onServerTime, finishRef, onSubmitted, underReviewFromServer }) {
  const monitoring = useExamMonitoring();
  const online = useOnlineStatus();
  const questions = attempt.questions || [];
  const [index, setIndex] = useState(0);
  // Real API: question.answer = { answerValue, version } (resume ke liye). MCQ_MULTIPLE ka empty value = [].
  const [answers, setAnswers] = useState(() => Object.fromEntries(questions.map((q) => [q.id, q.answer ? q.answer.answerValue : (q.type === 'MCQ_MULTIPLE' ? [] : '')])));
  const initialVersions = useMemo(() => Object.fromEntries(questions.filter((q) => q.answer).map((q) => [q.id, q.answer.version])), [questions]);
  const [underReview, setUnderReview] = useState(attempt.status === 'UNDER_REVIEW');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);
  const idemKey = useRef(null);
  const doneRef = useRef(false);
  const confirmBtn = useRef(null);
  const armedAt = useRef(Date.now());
  const autoRef = useRef(false);
  const [autoReason, setAutoReason] = useState(null);
  const fsSeen = useRef(false);
  // Strict mode + fullscreen policy: fullscreen me aaye bina exam shuru nahi (native kiosk / fullscreen-unsupported browser par gate nahi).
  const needFs = !!policy.autoSubmitOnViolation && !!policy.fullscreen && !isNativeClient() && typeof document !== 'undefined' && !!document.fullscreenEnabled;
  useEffect(() => { if (monitoring.status.fullscreen) fsSeen.current = true; }, [monitoring.status.fullscreen]);

  const autosave = useAutosave({ attemptId: attempt.id, saveFn: (qid, body) => saveAnswer(attempt.id, qid, body), initialVersions });
  const { remainingSeconds } = useTimer({ expiresAt, offsetMs: clock.offsetMs, onExpire: () => setExpired(true) });

  // Submit ya terminal: monitors stop + events final flush + onSubmitted.
  const finish = useCallback(async (result) => {
    if (doneRef.current) return;
    doneRef.current = true;
    await monitoring.finalize();
    onSubmitted && onSubmitted(result);
  }, [monitoring, onSubmitted]);
  finishRef.current = (status) => finish({ status });

  const recovery = useOfflineRecovery({
    online,
    graceSeconds: policy.offlineGraceSeconds,
    heartbeat: () => heartbeat(attempt.id),
    onServerTime,
    flushAnswers: autosave.retryNow,
    flushEvents: monitoring.flush,
    discardAnswers: autosave.clearLocal,
    onTerminal: (status) => finish({ status, discardedLocalAnswers: true }),
  });

  const q = questions[index];
  const setAnswer = (id, value) => { setAnswers((a) => ({ ...a, [id]: value })); autosave.queueAnswer(id, value); };
  const go = (i) => setIndex(Math.min(Math.max(i, 0), questions.length - 1));

  const onKeyDown = (e) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  };

  useEffect(() => {
    if (!confirming) return undefined;
    if (confirmBtn.current) confirmBtn.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming]);

  const doSubmit = async (extra = {}) => {
    setSubmitting(true);
    setError(null);
    try {
      await autosave.retryNow(); // pehle pending answers sync
      if (!idemKey.current) idemKey.current = crypto.randomUUID();
      let result = {};
      try {
        result = (await submit(attempt.id, idemKey.current)) || {};
      } catch (err) {
        const terminal = terminalStatusFromError(err);
        if (!terminal) throw err;
        result = { status: terminal };
      }
      setConfirming(false);
      await finish({ status: 'SUBMITTED', ...result, ...extra });
    } catch {
      setError('Could not submit right now. Your answers are saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Proctored auto-submit: fullscreen exit / tab switch / focus loss => turant submit (retry jab tak ho na jaye).
  useEffect(() => {
    const t = monitoring.lastWarningType;
    if (!policy.autoSubmitOnViolation || !monitoring.warningSeq || doneRef.current || autoRef.current) return;
    if (needFs && !fsSeen.current) return;   // pehli baar fullscreen me aane se pehle koi violation nahi
    if (!STRICT_EVENTS.has(t) || Date.now() - armedAt.current < AUTO_SUBMIT_ARM_MS) return;
    autoRef.current = true;
    const reason = AUTO_REASON[t];
    setAutoReason(reason);
    (async () => {
      for (let i = 0; !doneRef.current; i++) {
        await doSubmit({ autoSubmitted: true, autoSubmitReason: reason });
        if (doneRef.current) return;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** i, 15000)));
      }
    })();
  }, [monitoring.warningSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`exam-shell${policy.accessibilityMode ? ' exam-shell--a11y' : ''}`}>
      <a className="skip-link" href="#exam-main">Skip to question</a>
      <StatusBar
        remainingSeconds={remainingSeconds} saveStatus={autosave.status} online={online}
        fullscreen={monitoring.status.fullscreen} fullscreenRequired={policy.fullscreen} onRetry={autosave.retryNow}
      />
      <FullscreenBanner />
      {policy.accessibilityMode && <AccessibilityNotice />}
      {recovery.bannerMessage && <div className={`offline-banner${recovery.escalated ? ' offline-banner--escalated' : ''}`} role="status">{recovery.bannerMessage}</div>}
      {recovery.notice && <div className="offline-banner" role="alert">{recovery.notice}</div>}
      {expired && <div className="offline-banner" role="alert">Time is up. Waiting for the server to finalize your exam.</div>}
      {(underReviewFromServer ?? underReview) && <p role="status" className="offline-banner">Your attempt has been paused for review. Please wait for further instructions.</p>}
      <WarningToast />
      {needFs && !monitoring.status.fullscreen && !autoReason && !doneRef.current && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fs-title">
            <h2 id="fs-title">Enter fullscreen to continue</h2>
            <p>This exam must run in fullscreen. Leaving fullscreen, switching tabs or switching windows will submit your exam automatically.</p>
            <button type="button" className="primary" onClick={() => monitoring.enterFullscreen()}>Enter fullscreen</button>
          </div>
        </div>
      )}
      {policy.autoSubmitOnViolation && <p role="note" className="offline-banner">Leaving fullscreen or switching tabs will submit your exam automatically.</p>}
      {autoReason && <div role="alert" className="offline-banner offline-banner--escalated">Your exam is being submitted automatically because {autoReason}.</div>}

      <div className="exam-body">
        <nav aria-label="Question navigation" className="question-nav">
          <ol>
            {questions.map((qq, i) => (
              <li key={qq.id}>
                <button type="button" aria-current={i === index ? 'step' : undefined} aria-label={`Question ${i + 1}${isAnswered(answers[qq.id]) ? ', answered' : ''}`} onClick={() => go(i)}>
                  {i + 1}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main id="exam-main" tabIndex={-1} data-exam-content onKeyDown={onKeyDown} aria-label="Exam question">
          {q ? (
            <>
              <p className="question-position" aria-live="polite">Question {index + 1} of {questions.length}</p>
              <QuestionCard key={q.id} attemptId={attempt.id} question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} answerLabel={`Answer for question ${index + 1}`} />
            </>
          ) : <p>No questions available.</p>}
        </main>
      </div>

      <footer className="exam-actions">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0}>Previous</button>
        <button type="button" onClick={() => go(index + 1)} disabled={index >= questions.length - 1}>Next</button>
        <button type="button" className="primary" onClick={() => setConfirming(true)}>Submit exam</button>
      </footer>

      {confirming && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="submit-title">
            <h2 id="submit-title">Submit your exam?</h2>
            <p>You will not be able to change your answers after submitting.</p>
            {error && <p role="alert">{error}</p>}
            <button type="button" onClick={() => setConfirming(false)} disabled={submitting}>Cancel</button>
            <button type="button" ref={confirmBtn} className="primary" onClick={() => doSubmit()} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Confirm submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExamShell({ attempt, consentGiven, onSubmitted }) {
  const { accessToken } = useAuth();
  const policy = useMemo(() => resolvePolicy(attempt.monitoringPolicy), [attempt.monitoringPolicy]);
  const clock = useServerClock({ initialServerTime: attempt.serverTime });
  const [expiresAt, setExpiresAt] = useState(attempt.expiresAt);
  const finishRef = useRef(null);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const onServerTime = useCallback((serverTime, exp) => {
    if (serverTime) clock.sync(serverTime);
    if (exp) setExpiresAt(exp); // expiry server decide karta hai
  }, [clock.sync]); // eslint-disable-line

  const [underReviewTop, setUnderReviewTop] = useState(null);
  const onAttemptStatus = useCallback((status) => {
    setUnderReviewTop(status === 'UNDER_REVIEW');
    if (TERMINAL_STATUSES.has(status) && finishRef.current) finishRef.current(status);
  }, []);

  // Native client ho toh session bind; token refresh par dobara bind.
  useEffect(() => {
    if (!isNativeClient()) return undefined;
    bindNativeClient({ attemptId: attempt.id, accessToken: tokenRef.current });
    return onAccessTokenChange((token) => bindNativeClient({ attemptId: attempt.id, accessToken: token }));
  }, [attempt.id]);

  return (
    <MonitoringProvider attemptId={attempt.id} policy={policy} consentGiven={consentGiven} onServerTime={onServerTime} onAttemptStatus={onAttemptStatus}>
      <ExamShellInner
        attempt={attempt} policy={policy} expiresAt={expiresAt} clock={clock} underReviewFromServer={underReviewTop}
        onServerTime={onServerTime} finishRef={finishRef} onSubmitted={onSubmitted}
      />
    </MonitoringProvider>
  );
}
