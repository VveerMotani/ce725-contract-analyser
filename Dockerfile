# Live website on Render: the website, the API and the saved Claude-read runs in one service.

# 1. Build the website
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. Python server
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY . .
COPY --from=web /web/dist frontend/dist

ENV PYTHONUNBUFFERED=1 \
    ANALYSER_HOSTED=1

# Parse the four benchmark PDFs once at build time so the first visit is fast
RUN cd backend && python -c "from analyser.ingest import benchmark_package; [benchmark_package(c) for c in ('BM1', 'BM2', 'BM3', 'BM4')]"

# Render gives the port in $PORT
CMD uvicorn analyser.api.app:app --host 0.0.0.0 --port ${PORT:-10000} --app-dir backend
