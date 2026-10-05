from logging.config import fileConfig
from alembic import context
from sqlalchemy import create_engine, pool
from app.config import get_settings
from app.models.base import Base
import app.models  # noqa: F401  (saare models register ho jaye)

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata
URL = get_settings().DATABASE_URL  # DATABASE_URL env se hi aata hai


def run_migrations_offline():
    context.configure(url=URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    engine = create_engine(URL, poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
