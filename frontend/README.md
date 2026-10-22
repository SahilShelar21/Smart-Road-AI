# SmartRoad AI frontend

    npm install
    npm run dev        # http://localhost:5173

The dev server proxies /api to http://localhost:8000, so the backend must be running.
Easiest way (from the project root, with .env created):

    docker compose up --build db backend

Then sign in with the ADMIN_EMAIL / ADMIN_PASSWORD from .env.
Camera and GPS work on http://localhost. On a phone they need HTTPS.
Detection returns an error until models/pothole.pt exists (see root README).
