#!/bin/bash
cd "$(dirname "$0")/.."
rm -f dev_data/notebooks.db
rm -f dev_data/*.db-journal
rm -f dev_data/*.db-wal
echo "✅ Database reset. Restart the server."