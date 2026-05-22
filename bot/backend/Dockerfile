FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl gcc python3-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 --retries=5 -r requirements.txt
COPY . .
RUN mkdir -p /app/data
ENV BE_PORT=8000
EXPOSE $BE_PORT
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${BE_PORT}/health || exit 1
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${BE_PORT}"
