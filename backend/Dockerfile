# Pinned to the Debian 12 image first used for this project so Docker's build cache keeps working.
FROM python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 libxcb1 libsm6 libxext6 libxrender1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
# ultralytics pulls in opencv-python, which clashes with opencv-python-headless and breaks cv2. Keep only headless.
RUN pip uninstall -y opencv-python opencv-python-headless && pip install --no-cache-dir "opencv-python-headless>=4.10,<5" && python -c "import cv2; cv2.CascadeClassifier"
COPY requirements-extra.txt .
RUN pip install --no-cache-dir -r requirements-extra.txt
COPY . .
RUN useradd -m app && mkdir -p /data/evidence && chown -R app /data /app
USER app
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
