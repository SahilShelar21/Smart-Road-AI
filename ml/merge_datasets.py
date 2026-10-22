"""Merge several YOLO-format datasets into ONE single-class ('pothole') dataset.

Usage:
  python merge_datasets.py --out merged --src ds_roboflow --src ds_rdd2022 --src smartroad_training_data
Each source folder needs a data.yaml and train / valid (or val) / test folders with images/ and labels/
(the SmartRoad export has flat images/ and labels/ and is put into train).
Only classes whose name contains a --keep word (default: pothole, d40) become class 0; every other class
is dropped from the labels. Exact duplicate images across sources are skipped.
"""
import argparse, hashlib, os, shutil, yaml

p = argparse.ArgumentParser()
p.add_argument("--out", required=True)
p.add_argument("--src", action="append", required=True)
p.add_argument("--keep", default="pothole,d40", help="comma list of class-name fragments to keep")
a = p.parse_args()
keep = [k.strip().lower() for k in a.keep.split(",")]
SPLITS = {"train": ["train"], "val": ["valid", "val"], "test": ["test"]}
seen, counts = set(), {"train": 0, "val": 0, "test": 0}

for sp in SPLITS:
    os.makedirs(f"{a.out}/{sp}/images", exist_ok=True); os.makedirs(f"{a.out}/{sp}/labels", exist_ok=True)

for idx, src in enumerate(a.src):
    cfg = yaml.safe_load(open(os.path.join(src, "data.yaml")))
    names = cfg["names"]; names = list(names.values()) if isinstance(names, dict) else list(names)
    ids = {i for i, n in enumerate(names) if any(k in str(n).lower() for k in keep)}
    if not ids:
        print(f"[{src}] WARNING no class matches {keep}; classes are {names}. Skipping."); continue
    for sp, folders in SPLITS.items():
        for f in folders:
            img_dir = os.path.join(src, f, "images")
            if not os.path.isdir(img_dir) and f == "train":
                img_dir = os.path.join(src, "images")  # flat SmartRoad export
            if not os.path.isdir(img_dir):
                continue
            lab_dir = img_dir.replace("images", "labels")
            for fn in sorted(os.listdir(img_dir)):
                ipath = os.path.join(img_dir, fn)
                digest = hashlib.md5(open(ipath, "rb").read()).hexdigest()
                if digest in seen:
                    continue
                seen.add(digest)
                stem = os.path.splitext(fn)[0]
                lines = []
                lpath = os.path.join(lab_dir, stem + ".txt")
                if os.path.isfile(lpath):
                    for ln in open(lpath).read().splitlines():
                        parts = ln.split()
                        if len(parts) >= 5 and int(float(parts[0])) in ids:
                            lines.append("0 " + " ".join(parts[1:5]))
                new = f"{idx}_{stem}"
                shutil.copy(ipath, f"{a.out}/{sp}/images/{new}{os.path.splitext(fn)[1]}")
                open(f"{a.out}/{sp}/labels/{new}.txt", "w").write("\n".join(lines))
                counts[sp] += 1

yaml.safe_dump({"path": os.path.abspath(a.out), "train": "train/images", "val": "val/images", "test": "test/images", "names": {0: "pothole"}},
               open(f"{a.out}/data.yaml", "w"))
print("Merged images per split:", counts)
if counts["test"] == 0:
    print("NOTE: no test split. Move ~10% of val or train into test so final metrics are really held out.")
