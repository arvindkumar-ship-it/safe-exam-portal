from datetime import datetime
from sqlalchemy.orm import Session
from app.models.revoked_token import RevokedToken


def revoke_token(db: Session, jti: str, expires_at: datetime) -> None:
    if not db.get(RevokedToken, jti):
        db.add(RevokedToken(jti=jti, expires_at=expires_at))
        db.commit()


def is_revoked(db: Session, jti: str) -> bool:
    return db.get(RevokedToken, jti) is not None
