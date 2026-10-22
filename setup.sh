#!/usr/bin/env bash
# Creates .env with random secrets, then builds and starts everything.
set -e
cd "$(dirname "$0")"
rand() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
if [ -f .env ]; then
  echo ".env already exists - keeping it."
else
  ADMIN_PW=$(rand 8)
  cat > .env <<ENV
POSTGRES_DB=smartroad
POSTGRES_USER=smartroad
POSTGRES_PASSWORD=$(rand 16)
JWT_SECRET=$(rand 32)
ADMIN_EMAIL=admin@smartroad.local
ADMIN_PASSWORD=$ADMIN_PW
MODEL_FILE=pothole.pt
MIN_CONFIDENCE=0.4
CORS_ORIGINS=http://localhost:8080
ENV
  echo "Created .env. Admin login: admin@smartroad.local / $ADMIN_PW"
fi
mkdir -p models
[ -f models/pothole.pt ] || echo "NOTE: models/pothole.pt not found. The app will start, but detection returns an error until you train a model (see GUIDE.md step 2)."
docker compose up --build -d
echo "Open http://localhost:8080  (API docs: http://localhost:8000/docs)"
echo "Logs: docker compose logs -f backend"
