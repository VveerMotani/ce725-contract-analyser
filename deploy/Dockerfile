# Hugging Face Space (Docker SDK): read-only demo of the saved Claude-read results.
FROM python:3.12-slim

# Spaces run the container as user 1000
RUN useradd -m -u 1000 user
WORKDIR /app

COPY --chown=user backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY --chown=user . .
USER user

ENV PYTHONUNBUFFERED=1 \
    ANALYSER_READ_ONLY=1

# Parse the four benchmark PDFs once at build time so the first visit is fast
RUN cd backend && python -c "from analyser.ingest import benchmark_package; [benchmark_package(c) for c in ('BM1', 'BM2', 'BM3', 'BM4')]"

EXPOSE 7860
CMD ["uvicorn", "analyser.api.app:app", "--host", "0.0.0.0", "--port", "7860", "--app-dir", "backend"]
