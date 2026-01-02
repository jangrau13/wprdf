#!/bin/bash

cd "$(dirname "$0")/../server"

mkdir -p ../dev_data

if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# Setup WASM if needed
if [ ! -d "wasm_editor" ]; then
    echo "Setting up Marimo WASM..."
    ./setup_marimo_wasm.sh
fi

echo "Syncing dependencies..."
uv sync --dev

echo "Populating database..."
uv run ../dev/populate_db.py

# Load environment variables
if [ -f "../.env.example" ]; then
    export $(cat ../.env.example | grep -v '^#' | xargs)
fi

export REGISTRY_PATH="../dev_data/notebooks.db"
export HOST="127.0.0.1"
export PORT="${PORT:-8080}"

echo "Starting development server..."
uv run uvicorn wprdf_server.main:app --host $HOST --port $PORT --reload