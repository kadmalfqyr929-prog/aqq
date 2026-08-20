FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Create virtual environment and ensure venv binaries are on PATH
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python deps early for layer caching
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy application code
COPY . /app

# Ensure the start script is executable
RUN chmod +x ./start_prod.sh

# Expose the port (Railway will provide $PORT at runtime)
EXPOSE 8080

# Run the project's entrypoint which performs migrations then execs gunicorn
CMD ["./start_prod.sh"]
