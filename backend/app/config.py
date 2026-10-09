from functools import lru_cache
from pydantic import ValidationError, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    ENV: str = "local"
    DATABASE_URL: str
    TEST_DATABASE_URL: str = ""
    JWT_SECRET: str = Field(min_length=32)
    JWT_ACCESS_MINUTES: int = 60
    JWT_REFRESH_DAYS: int = 7
    ALLOWED_ORIGINS: str = "http://localhost:5173"
    SUBMIT_GRACE_SECONDS: int = 5
    LOGIN_MAX_FAILS: int = 5
    LOGIN_LOCK_MINUTES: int = 15
    EVENT_TIMESTAMP_TOLERANCE_SECONDS: int = 300
    EVENT_METADATA_MAX_BYTES: int = 2048
    EVENT_BATCH_MAX: int = 100
    EXPIRY_SWEEP_SECONDS: int = 30
    # --- coding judge ---
    CODE_MAX_SOURCE_BYTES: int = 65536
    CODE_MAX_INFLIGHT: int = 3                # ek attempt ke max QUEUED+JUDGING jobs
    CODE_MIN_INTERVAL_SECONDS: float = 2.0    # same attempt+question ke do submissions ke beech
    CODE_MAX_SUBMITS_PER_QUESTION: int = 100
    CODE_MAX_RUNS_PER_QUESTION: int = 300
    TEST_MAX_BYTES: int = 2_000_000           # ek test ka input ya output
    TESTS_MAX_PER_QUESTION: int = 100
    TEST_UPLOAD_MAX_BYTES: int = 20_000_000   # ek request
    JUDGE_LEASE_SECONDS: int = 60
    JUDGE_MAX_TRIES: int = 3
    JUDGE_EMBEDDED: bool = False       # True: backend khud judge worker (child process) chalaye -- single Render service ke liye
    STRICT_MODE_DEFAULT: bool = True   # exam policy me autoSubmitOnViolation na ho toh yahi lagu (exam false de toh opt-out)

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


def load_settings(**kw) -> Settings:
    """Galat/missing env par saaf message (kaun si vars dikkat me hain)."""
    try:
        return Settings(**kw)
    except ValidationError as e:
        bad = ", ".join(sorted({str(x["loc"][0]) for x in e.errors()}))
        raise RuntimeError(f"Invalid or missing environment variables: {bad}") from None


@lru_cache
def get_settings() -> Settings:
    return load_settings()