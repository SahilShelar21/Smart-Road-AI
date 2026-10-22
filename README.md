# SmartRoad AI

Live-camera pothole detection → GPS-tagged report → PostGIS → map, dashboard and repair workflow.
FastAPI · React/Vite/TS/Tailwind · YOLO (Ultralytics/PyTorch) · OpenCV · PostgreSQL+PostGIS · Docker.

## What is implemented
- Auth with roles (citizen / officer / admin); admin seeded from `.env`, roles changed in Admin tab
- Live camera detection loop with boxes + confidence; server re-runs detection on every submitted report
- Video-file mode for demos on recorded footage (reports are tagged `video_file`, location entered manually)
- GPS + server timestamp, PostGIS storage, duplicate merging (≤15 m, ≤30 days, unresolved)
- Severity (low/medium/high) from box area vs frame — an **uncalibrated heuristic**, labelled as such
- Map (Leaflet/OpenStreetMap), live dashboard (all numbers from SQL), model card showing metrics.json
- Repair workflow: assign → in_repair → repaired (needs "after" photo) → verified (by someone other than assignee); before/after shown side by side
- Privacy: best-effort face/plate blur (OpenCV Haar), EXIF stripped, evidence behind auth, audit log
- API docs at /docs, Alembic migrations, tests

## NOT implemented / not validated
- Width/length/depth estimation: **not implemented** (needs camera calibration + manual ground-truth comparison)
- No trained model is shipped. Without `models/pothole.pt`, detection returns 503 — there are no fake predictions
- Face/plate blur has limited recall; no retention/deletion job; no rate limiting; JWT in localStorage
- Image-similarity duplicate matching, model drift alerts, and real-world accuracy figures are not done
- This code has not been executed end to end by its author (no network/GPU in the build sandbox). Treat first run as integration testing.

> See GUIDE.md for the full step-by-step run guide (setup.sh / setup.ps1 automate setup and start).

## Run the demo
1. `cp .env.example .env` and set all CHANGE_ME values.
2. Train a model (needs internet; a GPU helps):
   - Download a YOLO-format pothole dataset with a licence you accept (Roboflow Universe or Kaggle both host several).
   - `pip install ultralytics && cd ml && python train.py --data /path/to/data.yaml --epochs 100`
   - This writes `models/pothole.pt` and `models/metrics.json` (held-out test precision/recall/mAP).
3. `docker compose up --build`
4. Open http://localhost:8080 (API docs http://localhost:8000/docs). Sign in with ADMIN_EMAIL / ADMIN_PASSWORD.

## Demo script (≈5 min)
1. Register a second account in a private window (citizen). In the admin account's Admin tab, promote it to officer.
2. Citizen: Scan road tab → "Use a video file" → pick dashcam footage → enter coordinates → Report this pothole when boxes appear.
3. Submit a second report of the same spot: it merges into the first (confirmations = 2).
4. Map tab shows the hazard; Dashboard shows live counts and the model's held-out metrics.
5. Officer/admin: All reports → assign → Mark in_repair → upload after photo → Mark repaired → verify from a different account.
6. Admin tab shows the audit trail.

Phones need HTTPS for camera access (use a reverse proxy with a certificate).

## Tests
`cd backend && pip install -r requirements.txt && pytest` — rules/security/health tests. DB-backed integration tests are not written yet.
