"""등록 원본과 촬영본의 특징점 대응으로 작품 위치를 추정한다.

CLIP 점수만으로 위치를 추측하지 않는다. 충분한 기하 검증이 없으면 null을 반환한다.
https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html
"""
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps


def grayscale(content: bytes):
    with Image.open(BytesIO(content)) as source:
        with ImageOps.exif_transpose(source) as image:
            image.thumbnail((960, 960))
            return np.array(image.convert("L"))


def framing_hint(bbox):
    x, y, width, height = bbox
    cx, cy = x + width / 2, y + height / 2
    if cx < 0.4:
        return "move_left"
    if cx > 0.6:
        return "move_right"
    if cy < 0.4:
        return "move_up"
    if cy > 0.6:
        return "move_down"
    if width * height < 0.25:
        return "move_closer"
    if width > 0.95 or height > 0.95:
        return "move_back"
    return "hold_still"


def locate_artwork(capture: bytes, reference: bytes):
    """반환 bbox는 EXIF 회전 보정된 촬영본 대비 [x,y,width,height]."""
    query, original = grayscale(capture), grayscale(reference)
    detector = cv2.ORB_create(nfeatures=1500)
    kp1, des1 = detector.detectAndCompute(original, None)
    kp2, des2 = detector.detectAndCompute(query, None)
    if des1 is None or des2 is None or len(des2) < 2:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des1, des2, k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.7 * pair[1].distance]
    # 촬영 특징점 중복으로 대응 수가 부풀려지지 않게 한다.
    good = list({m.trainIdx: m for m in sorted(good, key=lambda m: -m.distance)}.values())
    if len(good) < 12:
        return None
    src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    transform, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if transform is None or mask is None or int(mask.sum()) < 10 or mask.mean() < 0.6:
        return None
    h, w = original.shape
    # 작은 반복 무늬만 맞은 경우 작품 전체로 확장하지 않는다.
    inliers = src[mask.ravel().astype(bool)]
    if cv2.contourArea(cv2.convexHull(inliers)) < 0.1 * w * h:
        return None
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    # 투영 중 무한대/뒤집힌 평면을 거르는 분모 부호 검사.
    homogeneous = np.column_stack((corners.reshape(-1, 2), np.ones(4))) @ transform.T
    if np.any(np.abs(homogeneous[:, 2]) < 1e-6) or not (np.all(homogeneous[:, 2] > 0) or np.all(homogeneous[:, 2] < 0)):
        return None
    projected = cv2.perspectiveTransform(corners, transform).reshape(-1, 2)
    if not np.isfinite(projected).all() or not cv2.isContourConvex(projected):
        return None
    qh, qw = query.shape
    normalized = projected / [qw, qh]
    # 일부가 잘려 작품 전체 위치를 확인할 수 없으면 잘못된 방향 안내를 하지 않는다.
    if np.any(normalized < -0.02) or np.any(normalized > 1.02):
        return None
    x, y = np.clip(normalized.min(axis=0), 0, 1)
    right, bottom = np.clip(normalized.max(axis=0), 0, 1)
    width, height = float(right - x), float(bottom - y)
    polygon_area = abs(cv2.contourArea(projected)) / (qw * qh)
    if width * height < 0.02 or polygon_area < 0.02 or polygon_area < 0.3 * width * height:
        return None
    bbox = [float(x), float(y), width, height]
    return {"artwork_bbox": bbox, "framing_hint": framing_hint(bbox)}
