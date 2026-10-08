import MonitoringBanner from '../monitoring/MonitoringBanner.jsx';
import Icon from '../../components/Icon.jsx';

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
      <div role="timer" aria-label="Time remaining" className="status-bar__timer"><Icon name="clock" size={17} />{formatTime(remainingSeconds)}</div>
      <div role="status" aria-live="polite" className="status-bar__save" data-status={saveStatus}>
        {SAVE_TEXT[saveStatus] || saveStatus}
        {saveStatus === 'FAILED' && <button type="button" className="btn btn-link" onClick={onRetry}>Retry now</button>}
      </div>
      <div className="status-bar__chips">
        <div className="status-bar__net" data-on={online}>{online ? 'Online' : 'Offline'}</div>
        {fullscreenRequired && <div className="status-bar__fs" data-on={fullscreen}>{fullscreen ? 'Fullscreen on' : 'Fullscreen off'}</div>}
      </div>
      <MonitoringBanner />
    </header>
  );
}
