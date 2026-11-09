#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Optional local scene analysis worker for lettering-workbench.

YOLOX finds people, DWPose (whole-body, 133 keypoints) finds faces, hands and bodies,
and a busy-ness/luma grid describes where text can sit. Same JSON-lines protocol as
typeset_worker.py; commands `analyze` and `ping`. The ONNX models are only read.
"""

import hashlib
import math
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from typeset_worker import serve  # noqa: E402


cv2.setNumThreads(int(os.environ.get('CW_SCENE_THREADS') or 2))  # stay light next to the render worker

POSE_DIR = Path(os.environ.get('LETTERING_MODEL_DIR') or Path(__file__).resolve().parent.parent / 'models')
DET_SIZE = 640
DET_SCORE, DET_NMS = 0.3, 0.65  # retain overlapping person candidates
POSE_W, POSE_H = 288, 384
MEAN = np.array([123.675, 116.28, 103.53], np.float32)
STD = np.array([58.395, 57.12, 57.375], np.float32)
KP_CONF = 0.3
MAX_PEOPLE = 8
GRID_LONG, GRID_CELL = 192, 16

FACE = range(23, 91)
LEFT_HAND, RIGHT_HAND = range(91, 112), range(112, 133)
BODY = range(0, 23)  # 0-16 body plus 17-22 feet

_models = {}


def _models_loaded():
    """Load both nets once. Returns None when a model file is missing."""
    if 'det' not in _models:
        det, pose = POSE_DIR / 'yolox_l.onnx', POSE_DIR / 'dw-ll_ucoco_384.onnx'
        if not det.is_file() or not pose.is_file():
            _models['det'] = None
        else:
            _models['det'] = cv2.dnn.readNetFromONNX(str(det))
            _models['pose'] = cv2.dnn.readNetFromONNX(str(pose))
    return None if _models['det'] is None else _models


# ---------------------------------------------------------------- YOLOX

def _grid_offsets():
    if 'grid' not in _models:
        grids, strides = [], []
        for stride in (8, 16, 32):
            size = DET_SIZE // stride
            xv, yv = np.meshgrid(np.arange(size), np.arange(size))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((size * size, 1), stride))
        _models['grid'] = (np.concatenate(grids), np.concatenate(strides))
    return _models['grid']


def detect_people(net, img):
    """Person boxes [(x0,y0,x1,y1), score] in source pixels."""
    h, w = img.shape[:2]
    ratio = min(DET_SIZE / h, DET_SIZE / w)
    nh, nw = int(h * ratio), int(w * ratio)
    padded = np.full((DET_SIZE, DET_SIZE, 3), 114, np.uint8)
    padded[:nh, :nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    net.setInput(padded.transpose(2, 0, 1)[None].astype(np.float32))
    out = net.forward()[0].copy()
    grids, strides = _grid_offsets()
    out[:, :2] = (out[:, :2] + grids) * strides
    out[:, 2:4] = np.exp(out[:, 2:4]) * strides
    scores = out[:, 4] * out[:, 5]  # objectness x person class
    keep = scores > DET_SCORE
    if not keep.any():
        return []
    cx, cy, bw, bh = (out[keep, i] for i in range(4))
    boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], 1) / ratio
    scores = scores[keep]
    rects = [[float(x0), float(y0), float(x1 - x0), float(y1 - y0)] for x0, y0, x1, y1 in boxes]
    picked = np.array(cv2.dnn.NMSBoxes(rects, scores.tolist(), DET_SCORE, DET_NMS)).flatten()
    found = [(boxes[i], float(scores[i])) for i in picked]
    found.sort(key=lambda item: -item[1])
    return found[:MAX_PEOPLE]


# ---------------------------------------------------------------- DWPose

def estimate_pose(net, img, box, angle=0):
    """133 keypoints (N,2) in source pixels and their confidences for one person box.
    angle (degrees) turns the crop, so a lying or upside-down person reaches the model upright."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a = math.radians(angle)
    u, v = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])  # crop x / y axes in the image
    w0, h0 = max(1.0, x1 - x0), max(1.0, y1 - y0)
    bw = (abs(w0 * u[0]) + abs(h0 * u[1])) * 1.25
    bh = (abs(w0 * v[0]) + abs(h0 * v[1])) * 1.25
    if bw / bh > POSE_W / POSE_H:
        bh = bw * POSE_H / POSE_W
    else:
        bw = bh * POSE_W / POSE_H
    tl = np.array([cx, cy]) - u * bw / 2 - v * bh / 2
    src = np.float32([tl, tl + u * bw, tl + v * bh])
    dst = np.float32([[0, 0], [POSE_W, 0], [0, POSE_H]])
    matrix = cv2.getAffineTransform(src, dst)
    crop = cv2.warpAffine(img, matrix, (POSE_W, POSE_H), flags=cv2.INTER_LINEAR)
    blob = ((crop[:, :, ::-1].astype(np.float32) - MEAN) / STD).transpose(2, 0, 1)[None]
    net.setInput(np.ascontiguousarray(blob))
    simcc_x, simcc_y = net.forward(net.getUnconnectedOutLayersNames())
    if simcc_x.shape[2] != POSE_W * 2:
        simcc_x, simcc_y = simcc_y, simcc_x
    px, py = simcc_x[0].argmax(1) / 2.0, simcc_y[0].argmax(1) / 2.0  # SimCC split ratio 2
    conf = np.minimum(simcc_x[0].max(1), simcc_y[0].max(1))
    inverse = cv2.invertAffineTransform(matrix)
    points = np.stack([px, py, np.ones_like(px)], 1) @ inverse.T
    return points, conf


def _part_box(points, conf, indices, min_points, inflate, size):
    idx = np.array(list(indices))
    chosen = points[idx][conf[idx] > KP_CONF]
    if len(chosen) < min_points:
        return None
    x0, y0 = chosen.min(0)
    x1, y1 = chosen.max(0)
    return _clip_box(x0, y0, x1, y1, inflate, size)


def _clip_box(x0, y0, x1, y1, inflate, size):
    w, h = size
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) * inflate / 2, (y1 - y0) * inflate / 2
    box = [int(round(max(0, cx - hw))), int(round(max(0, cy - hh))),
           int(round(min(w, cx + hw))), int(round(min(h, cy + hh)))]
    return box if box[2] > box[0] and box[3] > box[1] else None


HEAD = [0, 1, 2, 3, 4]  # nose, eyes, ears: steadier than the 68 face points on anime faces


def _head_box(points, conf, size):
    """Face box from head keypoints when the face points are too weak."""
    chosen = points[HEAD][conf[HEAD] > KP_CONF]
    if len(chosen) < 2:
        return None
    (x0, y0), (x1, y1) = chosen.min(0), chosen.max(0)
    half = max(x1 - x0, y1 - y0, 1) * 0.75
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return _clip_box(cx - half, cy - half, cx + half, cy + half, 1.0, size)


def _iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _dedupe(people):
    """The looser NMS can return one person twice; the same face means the same person."""
    kept = []
    for person in sorted(people, key=lambda p: -p['score']):
        twin = next((k for k in kept if person['face'] and k['face'] and _iou(person['face'], k['face']) > 0.4), None)
        if twin is not None:
            # Same face, but a clearly different body: a second person whose own head is out of frame
            # (pose estimation lends them the nearest face). Keep the body, drop the borrowed face.
            if not (person['body'] and twin['body'] and _iou(person['body'], twin['body']) < 0.5):
                continue
            person = {**person, 'face': None, 'face_conf': 0.0}
        kept.append(person)
    return kept


def _person(points, conf, size, box, score, source):
    face_idx = np.array(list(FACE))
    face = _part_box(points, conf, FACE, 5, 1.15, size) or _head_box(points, conf, size)
    hands = [b for b in (_part_box(points, conf, LEFT_HAND, 4, 1.2, size),
                         _part_box(points, conf, RIGHT_HAND, 4, 1.2, size)) if b]
    body = _part_box(points, conf, BODY, 3, 1.0, size)
    chest, crotch, feet = _key_parts(points, conf, size)
    if box is None:  # full-frame pass: the person is wherever confident keypoints are
        confident = points[conf > KP_CONF]
        if face is None and body is None or len(confident) < 3:
            return None
        (x0, y0), (x1, y1) = confident.min(0), confident.max(0)
        box = _clip_box(x0, y0, x1, y1, 1.0, size)
        score = float(conf[conf > KP_CONF].mean())
        if box is None:
            return None
    else:
        box = _clip_box(*box, 1.0, size)
        if box is None:  # a detection entirely outside the frame
            return None
    return {'box': box, 'score': round(min(1.0, max(0.0, score)), 3), 'source': source,
            'face': face, 'face_conf': round(float(conf[face_idx].mean()), 3),
            'hands': hands, 'body': body, 'chest': chest, 'crotch': crotch, 'feet': feet}


L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_ANKLE, R_ANKLE = 5, 6, 11, 12, 15, 16
L_FOOT, R_FOOT = [15, 17, 18, 19], [16, 20, 21, 22]  # ankle + big toe, small toe, heel


def _key_parts(points, conf, size):
    """Chest, crotch and feet boxes from body keypoints: what lettering must leave visible.
    Built along the shoulder→hip axis so lying, bent-over and upside-down bodies work too."""
    ok = lambda i: conf[i] > KP_CONF
    floor = max(size) * 0.04
    def square(c, r):
        r = max(r, floor)
        return _clip_box(c[0] - r, c[1] - r, c[0] + r, c[1] + r, 1.0, size)
    sh = (points[L_SHOULDER] + points[R_SHOULDER]) / 2 if ok(L_SHOULDER) and ok(R_SHOULDER) else None
    hp = (points[L_HIP] + points[R_HIP]) / 2 if ok(L_HIP) and ok(R_HIP) else None
    sw = float(np.linalg.norm(points[L_SHOULDER] - points[R_SHOULDER])) if sh is not None else 0.0
    hw = float(np.linalg.norm(points[L_HIP] - points[R_HIP])) if hp is not None else 0.0
    torso = float(np.linalg.norm(hp - sh)) if sh is not None and hp is not None else 0.0
    chest = crotch = None
    if sh is not None:
        c = sh + 0.35 * (hp - sh) if hp is not None else sh
        chest = square(c, max(sw * 0.6, torso * 0.35))
    if hp is not None:
        c = hp + 0.15 * (hp - sh) if sh is not None else hp
        crotch = square(c, max(hw * 0.6, torso * 0.3))
    feet = []
    for idx in (L_FOOT, R_FOOT):
        chosen = points[idx][conf[idx] > KP_CONF]
        if conf[idx[0]] > KP_CONF and len(chosen) >= 3:
            (x0, y0), (x1, y1) = chosen.min(0), chosen.max(0)
            c, r = ((x0 + x1) / 2, (y0 + y1) / 2), max(x1 - x0, y1 - y0) * 0.7
            b = square(c, max(r, floor * 0.8))
            if b: feet.append(b)
    return chest, crotch, feet


# ---------------------------------------------------------------- grids

def scene_grid(img):
    """Busy-ness and luma per cell; cells are 16 px of the image scaled to a 192 px long side."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale = GRID_LONG / max(h, w)
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    small = cv2.resize(gray, (sw, sh), interpolation=cv2.INTER_AREA).astype(np.float32)
    magnitude = cv2.magnitude(cv2.Sobel(small, cv2.CV_32F, 1, 0, ksize=3),
                              cv2.Sobel(small, cv2.CV_32F, 0, 1, ksize=3))
    magnitude = cv2.blur(magnitude, (3, 3))
    p95 = float(np.percentile(magnitude, 95))
    busy_map = np.clip(magnitude / p95, 0, 1) if p95 > 0 else np.zeros_like(magnitude)
    luma_map = small / 255.0
    cols, rows = math.ceil(sw / GRID_CELL), math.ceil(sh / GRID_CELL)
    busy, luma = [], []
    for row in range(rows):
        for col in range(cols):
            cell = (slice(row * GRID_CELL, (row + 1) * GRID_CELL), slice(col * GRID_CELL, (col + 1) * GRID_CELL))
            busy.append(round(float(busy_map[cell].mean()), 3))
            luma.append(round(float(luma_map[cell].mean()), 3))
    return {'cols': cols, 'rows': rows, 'cell_w': round(GRID_CELL * w / sw, 3),
            'cell_h': round(GRID_CELL * h / sh, 3), 'busy': busy, 'luma': luma}


# ---------------------------------------------------------------- commands

def read_image(path):
    data = np.fromfile(str(path), np.uint8)  # np.fromfile + imdecode handles unicode paths
    img = cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None
    if img is None:
        raise ValueError('无法读取图片: %s' % path)
    return img


def _best_pose(net, img, box, size):
    """Upright pose first; when face, chest or crotch is missing (lying, bent over, upside down),
    also try the crop turned 90/180/270 degrees and keep the most confident body."""
    def quality(pc):
        points, conf = pc
        chest, crotch, _ = _key_parts(points, conf, size)
        face = _part_box(points, conf, FACE, 5, 1.0, size) or _head_box(points, conf, size)
        body = conf[:17]
        return (int((body > KP_CONF).sum()) + 3 * (face is not None) + 3 * (chest is not None) + 3 * (crotch is not None),
                float(body.mean()))
    best = estimate_pose(net, img, box)
    chest, crotch, _ = _key_parts(*best, size)
    face = _part_box(best[0], best[1], FACE, 5, 1.0, size) or _head_box(*best, size)
    if face is not None and chest is not None and crotch is not None:
        return best
    best_q = quality(best)
    for angle in (90, 180, 270):
        pc = estimate_pose(net, img, box, angle)
        q = quality(pc)
        if q > best_q:
            best, best_q = pc, q
    return best


def _anime_keys(img, people):
    return []


def analyze(args):
    started = time.perf_counter()
    path = Path(args['path'])
    sha = args.get('sha') or hashlib.sha256(path.read_bytes()).hexdigest()
    img = read_image(path)
    h, w = img.shape[:2]
    scene = {'version': 1, 'sha': sha, 'width': w, 'height': h, 'available': False, 'people': []}
    models = _models_loaded()
    if models is not None:
        scene['available'] = True
        people = []
        for box, score in detect_people(models['det'], img):
            points, conf = _best_pose(models['pose'], img, box, (w, h))
            person = _person(points, conf, (w, h), box, score, 'yolox')
            if person:
                people.append(person)
        people = _dedupe(people)
        if not people:
            points, conf = _best_pose(models['pose'], img, (0, 0, w, h), (w, h))
            person = _person(points, conf, (w, h), None, 0.0, 'fullframe')
            people = [person] if person else []
        people.sort(key=lambda p: (p['box'][0] + p['box'][2], p['box'][1]))  # left to right
        scene['people'] = people
    scene['keys'] = _anime_keys(img, scene['people'])
    scene['grid'] = scene_grid(img)
    scene['ms'] = int((time.perf_counter() - started) * 1000)
    return scene


def ping(_args):
    return {'pong': True, 'pid': os.getpid(), 'available': _models_loaded() is not None}


if __name__ == '__main__':
    serve({'analyze': analyze, 'ping': ping}, {'code_hash': None, 'fonts_hash': None})
