#!/usr/bin/env python3
"""Proves Puffcodes scan.

Renders Puffcodes with the real app code in Chromium (test/puffcode-render.js:
the saved PNG and the on-screen art, for 24 links across short and long
usernames and origins, with and without avatars), then decodes every image
with OpenCV's cv2.QRCodeDetector and checks it reads back the exact link.
Each saved PNG is also tried on white, black and the app's dark background,
shrunk to 25%, blurred, and tilted the way a hand-held camera sees it.

How to run (from poof/; needs Node and Playwright, as for npm run test:e2e):

    python3 -m venv /tmp/qrcheck
    /tmp/qrcheck/bin/pip install opencv-python-headless
    /tmp/qrcheck/bin/python test/puffcode-scan.py

Exit code 0 when every image decodes to its exact link. If the zxing-cpp
package is installed too (pip install zxing-cpp), every image is also
decoded with it, as a second opinion.

Puffcodes are white dots on violet: a light-on-dark ("reflectance reversed")
QR code, which the QR standard allows and phone camera apps read. OpenCV's
detector only looks for dark-on-light codes, so each image is tried as it is
and then inverted, the way readers that support both kinds do it. The report
says which way each one read.
"""
import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
APP_BG = (0x1F, 0x12, 0x14)  # #14121f as BGR

try:
    import zxingcpp  # optional second decoder
except ImportError:
    zxingcpp = None


def flatten(img, bg):
    """Composite a BGRA image onto a solid BGR background."""
    if img.ndim == 2 or img.shape[2] == 3:
        return img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    alpha = img[:, :, 3:4].astype(np.float32) / 255
    back = np.empty_like(img[:, :, :3])
    back[:] = bg
    return (img[:, :, :3] * alpha + back * (1 - alpha)).astype(np.uint8)


def tilt(img):
    """A mild perspective tilt, as a hand-held camera sees a code."""
    h, w = img.shape[:2]
    pad = int(w * 0.15)
    img = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=APP_BG)
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[w * 0.06, h * 0.03], [w * 0.95, 0], [w, h], [w * 0.02, h * 0.94]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=APP_BG)


def variants(img, saved):
    """The ways each rendered image is checked."""
    if not saved:
        yield 'as rendered', flatten(img, APP_BG)
        return
    yield 'on white', flatten(img, (255, 255, 255))
    yield 'on black', flatten(img, (0, 0, 0))
    dark = flatten(img, APP_BG)
    yield 'on the app background', dark
    yield 'shrunk to 25%', cv2.resize(dark, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    yield 'blurred', cv2.GaussianBlur(cv2.resize(dark, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), (5, 5), 1.2)
    yield 'tilted', tilt(cv2.resize(dark, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))


def decode_cv2(bgr):
    """Decode with cv2.QRCodeDetector: as it is, then inverted. -> (text, way)."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    detector = cv2.QRCodeDetector()
    for way, image in (('as is', gray), ('inverted', 255 - gray)):
        text, points, _ = detector.detectAndDecode(image)
        if points is not None and text:
            return text, way
    return '', 'no read'


def decode_zxing(bgr):
    results = zxingcpp.read_barcodes(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    return results[0].text if results else ''


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='puffcodes-')
    subprocess.run(['node', os.path.join(HERE, 'puffcode-render.js'), out], check=True)
    with open(os.path.join(out, 'cases.json')) as f:
        cases = json.load(f)
    failures = 0
    checked = 0
    ways = {}
    for case in cases:
        img = cv2.imread(os.path.join(out, case['file']), cv2.IMREAD_UNCHANGED)
        assert img is not None, case['file']
        for name, bgr in variants(img, case['file'].endswith('-saved.png')):
            checked += 1
            text, way = decode_cv2(bgr)
            ways[way] = ways.get(way, 0) + 1
            ok = text == case['url']
            second = ''
            if zxingcpp is not None:
                z = decode_zxing(bgr)
                second = ' | zxing-cpp ' + ('ok' if z == case['url'] else 'FAILED (%r)' % z)
                ok = ok and z == case['url']
            if not ok:
                failures += 1
            print('%-4s %-28s %-26s cv2 %-9s %s%s' % ('ok' if ok else 'FAIL', case['file'], name, way,
                                                     text if text == case['url'] else repr(text), second))
    print('\n%d images checked, %d failed. cv2 read: %s' % (checked, failures,
                                                           ', '.join('%s %d' % kv for kv in sorted(ways.items()))))
    print('PNGs are in', out)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
