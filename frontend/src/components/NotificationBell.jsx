import { useEffect, useState } from "react";
import { notificationApi } from "../api/notificationApi";
import Icon from "./Icon";

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
      <button type="button" className="btn btn-ghost btn-icon" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" size={18} /> {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="region" aria-label="Notifications">
          {items.length === 0 && <p className="empty">No notifications.</p>}
          {items.map((n) => (
            <div key={n.id} className="bell-panel__item" data-unread={!n.isRead}>
              <button type="button" className="bell-panel__title" onClick={() => read(n)}>{n.title}</button>
              <div className="bell-panel__body">{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
