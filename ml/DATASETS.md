# Getting more training data (and higher accuracy)

More *relevant* images matter more than more epochs. Mix these sources, then retrain.

## 1. Public datasets (check each licence before use)
- **RDD2022 (Road Damage Detection 2022)**: includes an India subset; its D40 class is potholes. Best match for Indian roads.
- **Roboflow Universe**: search "pothole", export in *YOLOv8* format. Prefer single-class datasets.
- **Kaggle**: several pothole datasets exist; confirm they are YOLO-format and what licence they carry.

## 2. Your own footage (biggest gain for your roads)
1. Drive/walk your roads with Trip mode and auto-report on.
2. In **All Reports**, mark each detection **AI was right** or **False alarm**.
3. **Settings → Download training data** gives a YOLO dataset: confirmed boxes = labels, false alarms = negative frames.
4. Potholes the AI *missed* are not in that export. Label those frames in Roboflow or CVAT.

## 3. Merge and train
    python merge_datasets.py --out merged --src ds_rdd2022 --src ds_roboflow --src smartroad_training_data
    python train.py --data merged/data.yaml --base ../models/pothole.pt --epochs 60     # fine-tune your current model
    # or a fresh, bigger model on a GPU / Colab:
    python train.py --data merged/data.yaml --base yolov8s.pt --epochs 120

`merge_datasets.py` keeps only pothole classes, removes exact duplicate images, and warns if there is no test split.
Keep a **test split of your own local images that is never used for training**: that number tells you the real accuracy.

## 4. Check it really improved
Compare `metrics.json` before and after on the SAME test split, then try the new model on a few recordings and count false alarms and misses.
Copy `models/pothole.pt` + `models/metrics.json` into the project and run `docker compose restart backend`.
