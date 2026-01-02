FROM python:3.13-slim

WORKDIR /app

# Install uv and marimo
RUN pip install uv marimo

# Copy project files from the server directory (relative to root context)
COPY server/pyproject.toml server/README.md ./
RUN uv pip install --system .

# Copy the rest of the repository
COPY . .

# Move into the server directory for the rest of the setup
WORKDIR /app/server

# Generate WASM editor
RUN chmod +x setup_marimo_wasm.sh && ./setup_marimo_wasm.sh

# Run population script (it uses relative paths to find templates)
RUN python3 ../dev/populate_db.py

EXPOSE 8080

# Run from the server directory so wprdf_server is findable
CMD ["uvicorn", "wprdf_server.main:app", "--host", "0.0.0.0", "--port", "8080"]