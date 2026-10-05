from app.schemas.common import CamelModel


class SubmitReceipt(CamelModel):
    submission_id: str
    attempt_id: str
