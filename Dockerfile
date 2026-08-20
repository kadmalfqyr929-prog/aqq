FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Create virtual environment and ensure venv binaries are on PATH
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install system dependencies for better performance
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps early for layer caching
COPY requirements.txt ./
RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install whitenoise gunicorn

# Copy application code
COPY . /app

# Ensure the start script is executable
RUN chmod +x ./start_prod.sh

# Create staticfiles directory
RUN mkdir -p /app/staticfiles

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/api/health/ || exit 1

# Expose the port (Railway will provide $PORT at runtime)
EXPOSE 8080

# Run the project's entrypoint which performs migrations then execs gunicorn
CMD ["./start_prod.sh"]
