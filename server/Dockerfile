FROM python:3.12-slim

WORKDIR /app

# Install uv and marimo
RUN pip install uv marimo

# Copy project files
COPY pyproject.toml .
RUN uv pip install --system .

# Copy application
COPY . .

# Generate WASM editor
RUN chmod +x setup_marimo_wasm.sh && ./setup_marimo_wasm.sh

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]