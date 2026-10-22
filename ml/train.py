"""Fine-tune YOLO on a pothole dataset and write REAL held-out metrics.
Examples:
  python train.py --data merged/data.yaml --epochs 100
  python train.py --data merged/data.yaml --base ../models/pothole.pt --epochs 40     # continue from your current model
  python train.py --data merged/data.yaml --base yolov8s.pt --epochs 120              # bigger model, usually more accurate
Dataset must be YOLO format with train/val(/test) splits and a licence that permits your use.
"""
import argparse, json, shutil
from ultralytics import YOLO

p = argparse.ArgumentParser()
p.add_argument("--data", required=True)
p.add_argument("--base", default="yolov8n.pt")
p.add_argument("--epochs", type=int, default=100)
p.add_argument("--imgsz", type=int, default=640)
p.add_argument("--batch", type=int, default=16)
p.add_argument("--patience", type=int, default=30, help="stop early if no improvement for this many epochs")
a = p.parse_args()

model = YOLO(a.base)
model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, patience=a.patience,
            degrees=5, hsv_v=0.5, scale=0.5, project="runs", name="pothole", exist_ok=True)
best = YOLO(str(model.trainer.best))
try:
    m = best.val(data=a.data, split="test")  # evaluate on the untouched test split
    split = "test"
except Exception:
    print("WARNING: dataset has no test split; using val split. These metrics are NOT fully held out.")
    m = best.val(data=a.data, split="val")
    split = "val"
metrics = {"eval_split": split, "precision": float(m.box.mp), "recall": float(m.box.mr),
           "mAP50": float(m.box.map50), "mAP50-95": float(m.box.map)}
json.dump(metrics, open("metrics.json", "w"), indent=2)
shutil.copy(str(model.trainer.best), "../models/pothole.pt")
shutil.copy("metrics.json", "../models/metrics.json")
print(metrics)
