"""
Floor-plan segmentation → unit outlines.

Model: a YOLO segmentation model trained on floor plans. Put the weights at
`3d_map/models/units.pt` or point the YOLO_WEIGHTS env var at the file.
YOLO_UNIT_CLASSES (comma-separated) picks which classes count as a unit; by
default every class the model knows counts.

The stock COCO checkpoint (`yolo-v11-wt/yolo11n-seg.pt`: person, car, ...) is
detected and never used for units — it cannot see walls or rooms.

Without a usable model or plan image, units are *estimated*: the floor plate
is split recursively into plausible cells and labelled as an estimate.

Every unit polygon is in normalized 0..1 floor-plan coordinates (closed ring).
"""
import hashlib
import os

import numpy as np

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 3d_map/
DEFAULT_WEIGHTS = os.path.join(_BASE, "models", "units.pt")

_MODEL = None
_MODEL_PATH = None


def weights_path():
    return os.environ.get("YOLO_WEIGHTS") or DEFAULT_WEIGHTS


def _is_stock_coco(names):
    return len(names) == 80 and "person" in names.values()


def _get_model():
    """Load (and cache) the floor-plan model; raises with a readable reason."""
    global _MODEL, _MODEL_PATH
    path = weights_path()
    if _MODEL is not None and _MODEL_PATH == path:
        return _MODEL
    if not os.path.isfile(path):
        raise FileNotFoundError(f"no floor-plan model at {path}")
    from ultralytics import YOLO

    model = YOLO(path)
    if model.task != "segment":
        raise ValueError(f"{os.path.basename(path)} is a '{model.task}' model; a segmentation model is required")
    if _is_stock_coco(model.names):
        raise ValueError(f"{os.path.basename(path)} is the stock COCO model (people, cars...), not a floor-plan model")
    _MODEL, _MODEL_PATH = model, path
    return model


def _unit_class_ids(names):
    wanted = [c.strip().lower() for c in os.environ.get("YOLO_UNIT_CLASSES", "").split(",") if c.strip()]
    if not wanted:
        return set(names)  # every class counts as a unit
    return {i for i, n in names.items() if n.lower() in wanted}


def model_status():
    """What the segmentation step will use — shown to surveyors in the UI."""
    path = weights_path()
    try:
        model = _get_model()
    except Exception as e:  # noqa: BLE001 — any failure means "no model"
        return {"ready": False, "path": path, "reason": str(e)}
    keep = _unit_class_ids(model.names)
    return {
        "ready": True,
        "path": path,
        "file": os.path.basename(path),
        "classes": [model.names[i] for i in sorted(model.names)],
        "unit_classes": [model.names[i] for i in sorted(keep)],
    }


def _model_units(image_bytes, max_units=40):
    """Run the model; return [{'polygon': [[x, y], ...], 'confidence': c, 'label': name}]."""
    import cv2

    model = _get_model()
    keep = _unit_class_ids(model.names)
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("unreadable image")
    h, w = img.shape[:2]
    min_area = 0.004 * w * h  # ignore specks (< 0.4 % of the plan)
    res = model(img, conf=float(os.environ.get("YOLO_CONF", 0.35)), verbose=False)[0]
    if res.masks is None or res.boxes is None:
        return []

    out = []
    for i, m in enumerate(res.masks.data):
        cls = int(res.boxes.cls[i])
        if cls not in keep:
            continue
        mask = cv2.resize((m.cpu().numpy() * 255).astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        c = max(contours, key=cv2.contourArea)
        if cv2.contourArea(c) < min_area:
            continue
        # simplify to a handful of corners so units stay editable
        c = cv2.approxPolyDP(c, 0.01 * cv2.arcLength(c, True), True)
        if len(c) < 3:
            continue
        ring = [[round(float(x) / w, 4), round(float(y) / h, 4)] for x, y in c[:, 0, :]]
        ring.append(ring[0])
        out.append({"polygon": ring, "confidence": round(float(res.boxes.conf[i]), 3), "label": model.names[cls]})
    # reading order: top-to-bottom, left-to-right (unit numbers follow it)
    out.sort(key=lambda u: (round(min(p[1] for p in u["polygon"]), 1), min(p[0] for p in u["polygon"])))
    return out[:max_units]


def estimated_units(n_units, seed):
    """Estimate when no plan/model is available: recursive split into n cells."""
    if isinstance(seed, str):
        seed = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12], 16)
    rng = np.random.default_rng(int(seed) % (2**32))
    cells = [(0.05, 0.05, 0.95, 0.95)]
    while len(cells) < max(2, n_units):
        cells.sort(key=lambda c: (c[2] - c[0]) * (c[3] - c[1]), reverse=True)
        x0, y0, x1, y1 = cells.pop(0)
        w, h = x1 - x0, y1 - y0
        if w < 0.14 and h < 0.14:
            break
        t = float(rng.uniform(0.38, 0.62))
        if w >= h:
            cells += [(x0, y0, x0 + w * t, y1), (x0 + w * t, y0, x1, y1)]
        else:
            cells += [(x0, y0, x1, y0 + h * t), (x0, y0 + h * t, x1, y1)]
    return [
        {"polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], "confidence": None, "label": None}
        for x0, y0, x1, y1 in cells
    ]


def segment_floorplan(image_bytes=None, n_units=6, seed=0):
    """
    Returns {'source': 'model' | 'estimated', 'units': [...], 'note': str}.
    'note' says why an estimate was used, so the UI can tell the surveyor.
    """
    note = "no floor plan uploaded"
    if image_bytes:
        try:
            units = _model_units(image_bytes)
            if units:
                return {"source": "model", "units": units, "note": f"{len(units)} units detected"}
            note = "the model found no units in this plan"
        except Exception as e:  # noqa: BLE001 — degrade to an estimate, but say why
            note = str(e)
    return {"source": "estimated", "units": estimated_units(n_units, seed), "note": note}
