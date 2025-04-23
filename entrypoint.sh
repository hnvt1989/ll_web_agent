#!/bin/sh
# Ensure script exits immediately if a command exits with a non-zero status.
set -e

# Start the UI file server in the background, listening on port 8080
# The '-s' flag indicates single-page app handling (rewrites to index.html)
echo "Starting static file server for UI on port 8080..."
serve -s ui-static -l 8080 &

# Start the backend server in the foreground on port 3000
# Assumes the main built file is located at backend/dist/server.js
echo "Starting backend server on port 3000..."
exec node backend/dist/server.js 