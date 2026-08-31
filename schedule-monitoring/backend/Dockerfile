# schedule-monitoring/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ ./shared/

COPY schedule-monitoring/backend/requirements.txt ./schedule-monitoring/backend/requirements.txt
RUN pip install --no-cache-dir -r schedule-monitoring/backend/requirements.txt

COPY schedule-monitoring/backend/ ./schedule-monitoring/backend/

WORKDIR /app/schedule-monitoring/backend

ENV PYTHONPATH=/app

EXPOSE 8004

CMD ["python", "run.py"]
