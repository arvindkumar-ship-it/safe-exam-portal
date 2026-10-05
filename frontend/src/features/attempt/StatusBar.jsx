import MonitoringBanner from '../monitoring/MonitoringBanner.jsx';

const SAVE_TEXT = {
  IDLE: 'No changes yet', SAVING: 'Saving…', SAVED: 'All answers saved',
  FAILED: 'Save failed — retrying', OFFLINE: 'Offline — saved on this device',
};
export const formatTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

export default function StatusBar({ remainingSeconds, saveStatus, online, fullscreen, fullscreenRequired, onRetry }) {
  return (
    <header className="status-bar" aria-label="Exam status">
      <div role="timer" aria-label="Time remaining" className="status-bar__timer">{formatTime(remainingSeconds)}</div>
      <div role="status" aria-live="polite" className="status-bar__save" data-status={saveStatus}>
        {SAVE_TEXT[saveStatus] || saveStatus}
        {saveStatus === 'FAILED' && <button type="button" onClick={onRetry}>Retry now</button>}
      </div>
      <div className="status-bar__net">{online ? 'Online' : 'Offline'}</div>
      {fullscreenRequired && <div className="status-bar__fs">{fullscreen ? 'Fullscreen on' : 'Fullscreen off'}</div>}
      <MonitoringBanner />
    </header>
  );
}
