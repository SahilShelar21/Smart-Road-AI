"""Best-effort blurring of faces and licence plates before evidence is stored.
Uses OpenCV Haar cascades: fast but limited recall (especially for non-Russian plates and side faces).
For production, replace with a dedicated face/plate detector and test its recall."""
import cv2

_face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_plate = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_russian_plate_number.xml")

def blur_sensitive(img):
    out = img.copy()
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    for cascade in (_face, _plate):
        if cascade.empty():
            continue
        for (x, y, w, h) in cascade.detectMultiScale(gray, 1.1, 5, minSize=(40, 20)):
            roi = out[y:y + h, x:x + w]
            out[y:y + h, x:x + w] = cv2.GaussianBlur(roi, (0, 0), max(w, h) / 4)
    return out
