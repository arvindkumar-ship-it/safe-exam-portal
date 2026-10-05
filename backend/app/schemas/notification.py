from app.utils.clock import to_iso


def notification_out(n) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "isRead": n.is_read, "createdAt": to_iso(n.created_at)}
