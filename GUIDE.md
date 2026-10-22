# SmartRoad AI - how to run it

## 0. Install once
- **Docker Desktop** (includes Docker Compose): https://www.docker.com/products/docker-desktop - start it and wait until it says "running".
- **Node.js 20+** only if you want to run the frontend in dev mode (`npm run dev`).
- Free ports needed: 8080 (app), 8000 (API).

## 1. Start the app (one command)
Unzip the project, open a terminal in the `smartroad-ai` folder.

macOS / Linux:  `./setup.sh`
Windows (PowerShell):  `powershell -ExecutionPolicy Bypass -File setup.ps1`

This creates `.env` with random secrets, prints your admin login, builds three containers
(PostGIS database, FastAPI + YOLO backend, nginx + React frontend), runs the database migrations
and starts everything. The first build downloads PyTorch and takes several minutes.

Open **http://localhost:8080** and sign in with the admin email/password printed by the script
(also stored in `.env`). API docs: http://localhost:8000/docs

## 2. Get a real detection model (required for detection)
No model is bundled. Detection returns an error until `models/pothole.pt` exists - the app never fakes results.
1. Download a pothole dataset in **YOLO format** (Roboflow Universe: search "pothole" -> Download -> "YOLOv8"; or Kaggle). Check the licence allows your use. You should have a `data.yaml` with train/val(/test) folders.
2. Train (GPU strongly recommended - e.g. a free Google Colab GPU: upload the `ml` folder and dataset, run the same command, then download `pothole.pt` and `metrics.json`):
       pip install ultralytics
       cd ml
       python train.py --data /full/path/to/data.yaml --epochs 100
   This writes `models/pothole.pt` and `models/metrics.json` (precision, recall, mAP, and which split was used).
3. Restart the backend: `docker compose restart backend`.

## 3. Try it (5-minute demo)
1. **Scan road** tab -> allow camera + location, or use **"Use a video file"** and pick dashcam footage (then type a latitude/longitude, e.g. 19.0760 / 72.8777).
2. Yellow boxes with confidence % appear on real detections. Click **Report this pothole**.
3. Report the same spot again: it merges into the first hazard (confirmations = 2).
4. **Map** shows the hazard (colour = severity). **Dashboard** shows live database numbers and the model's offline metrics.
5. Register a second account, promote it to **officer** in the admin's **Admin** tab.
6. In **All reports**: assign -> Mark in_repair -> upload "after" photo -> Mark repaired. A *different* officer/admin then marks it verified (before/after shown side by side).
7. Admin tab -> audit log.

## 4. Frontend dev mode (optional)
Keep the backend running (`docker compose up -d db backend`), then:
    cd frontend
    npm install
    npm run dev          # http://localhost:5173 (proxies /api to :8000)

## 5. Tests
    cd backend && pip install -r requirements.txt && pytest

## 6. Everyday commands
- Stop: `docker compose down`   - Stop and wipe data: `docker compose down -v`
- Logs: `docker compose logs -f backend`
- Rebuild after code changes: `docker compose up --build -d`

## Troubleshooting
- **"No trained model at /models/pothole.pt"** - do step 2, then restart the backend.
- **Camera does not start** - needs `http://localhost` or HTTPS. On a phone you need HTTPS (put a reverse proxy with a certificate in front).
- **Backend keeps restarting** - `docker compose logs backend`; usually a migration/DB error. If you changed DB credentials after first start, run `docker compose down -v` and start again.
- **Port already in use** - change the left-hand port numbers in `docker-compose.yml`.
- **Login fails for admin** - the admin is created only on first start from `.env`; if you changed it later, use `docker compose down -v` (wipes data).

## Honest status
Not yet implemented: width/length/depth estimation (needs calibration + real measurements), image-similarity duplicate matching,
retention/deletion jobs, rate limiting, DB-backed integration tests. Face/plate blur is best-effort (limited recall).
Severity is an image-area heuristic, not a physical measure. This code was written without being run end to end,
so expect to fix small issues on first launch - send me the error output and I will patch it.
