FROM python:3.11-slim-bookworm
# Compilers/interpreters judge ke liye (JUDGE_EMBEDDED=true par backend ke andar hi code compile + run hota hai)
RUN apt-get update && apt-get install -y --no-install-recommends g++ gcc libc6-dev pypy3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# sandboxed code (uid drop) ko /app padhne nahi dena; /work me compile/run hota hai
RUN chmod -R go-rwx /app && mkdir -p /work && chmod 755 /work
ENV JUDGE_WORK_DIR=/work PYTHONUNBUFFERED=1
CMD ["sh","-c","alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]