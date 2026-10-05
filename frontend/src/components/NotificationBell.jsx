import { useEffect, useState } from "react";
import { notificationApi } from "../api/notificationApi";

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    notificationApi.list().then((l) => setItems(Array.isArray(l) ? l : [])).catch(() => {}); // bell fail ho toh page nahi tootna chahiye
  }, []);

  const unread = items.filter((n) => !n.isRead).length;

  async function read(n) {
    if (n.isRead) return;
    try {
      const updated = await notificationApi.markRead(n.id);
      setItems((list) => list.map((x) => (x.id === n.id ? updated : x)));
    } catch {
      /* next load par sync ho jayega */
    }
  }

  return (
    <div className="bell">
      <button type="button" className="btn btn-secondary" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>
        🔔 {unread > 0 && <span className="badge badge-warn">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="region" aria-label="Notifications">
          {items.length === 0 && <p className="empty">No notifications.</p>}
          {items.map((n) => (
            <div key={n.id} style={{ fontWeight: n.isRead ? 400 : 700 }}>
              <button type="button" className="btn btn-link" onClick={() => read(n)}>{n.title}</button>
              <div>{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
