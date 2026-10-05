"""
Frame texture pipeline: source frame photo (frame fills edge-to-edge, dark
center hole) -> normalized 1600x1600 nine-slice PNG with transparent center
(slice 140), plus luminance-preserving oak/black recolors.

Usage: python scripts/make-frame-textures.py <source.png> <out_dir>
"""
import sys
from PIL import Image, ImageOps, ImageFilter

CORNER = 140
CANVAS = 1600
EDGE = CANVAS - CORNER * 2
HOLE_THRESHOLD = 25
RUN = 14


def smooth(values, window=9):
    half = window // 2
    out = []
    for i in range(len(values)):
        lo, hi = max(0, i - half), min(len(values), i + half + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def hole_edge(line, center):
    """Walk from `center` outward; return first index where the line leaves
    the dark hole (sustained brightness above threshold)."""
    n = len(line)
    direction = 1 if center < n // 2 else -1
    i = center
    while 0 <= i < n:
        if all(line[min(max(j, 0), n - 1)] > HOLE_THRESHOLD for j in (i + k * direction for k in range(RUN))):
            return i
        i += direction
    return None


def measure(im):
    gray = im.convert("L")
    w, h = gray.size
    cx, cy = w // 2, h // 2
    row = smooth(list(gray.crop((0, cy, w, cy + 1)).getdata()))
    col = smooth(list(gray.crop((cx, 0, cx + 1, h)).getdata()))
    left = hole_edge(row, cx)
    right = hole_edge(row[::-1], w - 1 - cx)
    top = hole_edge(col, cy)
    bottom = hole_edge(col[::-1], h - 1 - cy)
    if None in (left, right, top, bottom):
        raise SystemExit("hole detection failed")
    x0, x1 = min(left, w - 1 - right), max(right, w - 1 - left)
    y0, y1 = min(top, h - 1 - bottom), max(bottom, h - 1 - top)
    return x0, y0, x1, y1


def nine_slice(im, box):
    """Crop corner/edge pieces from `im` per hole bbox, rescale onto the
    standard 1600x1600 grid, transparent center."""
    w, h = im.size
    x0, y0, x1, y1 = box
    t_left, t_top = x0, y0
    t_right, t_bottom = w - x1, h - y1

    pieces = {
        "tl": im.crop((0, 0, t_left, t_top)),
        "tr": im.crop((w - t_right, 0, w, t_top)),
        "bl": im.crop((0, h - t_bottom, t_left, h)),
        "br": im.crop((w - t_right, h - t_bottom, w, h)),
        "t": im.crop((t_left, 0, w - t_right, t_top)),
        "b": im.crop((t_left, h - t_bottom, w - t_right, h)),
        "l": im.crop((0, t_top, t_left, h - t_bottom)),
        "r": im.crop((w - t_right, t_top, w, h - t_bottom)),
    }
    targets = {
        "tl": (0, 0, CORNER, CORNER),
        "tr": (CANVAS - CORNER, 0, CANVAS, CORNER),
        "bl": (0, CANVAS - CORNER, CORNER, CANVAS),
        "br": (CANVAS - CORNER, CANVAS - CORNER, CANVAS, CANVAS),
        "t": (CORNER, 0, CANVAS - CORNER, CORNER),
        "b": (CORNER, CANVAS - CORNER, CANVAS - CORNER, CANVAS),
        "l": (0, CORNER, CORNER, CANVAS - CORNER),
        "r": (CANVAS - CORNER, CORNER, CANVAS, CANVAS - CORNER),
    }
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for key, piece in pieces.items():
        x0t, y0t, x1t, y1t = targets[key]
        out.paste(piece.resize((x1t - x0t, y1t - y0t), Image.LANCZOS), (x0t, y0t))
    return out


def recolor(base, black, mid, white):
    """Map the frame's luminance onto a new wood ramp, keep alpha."""
    lum = base.convert("RGB").convert("L")
    colored = ImageOps.colorize(lum, black=black, white=white, mid=mid).convert("RGBA")
    colored.putalpha(base.getchannel("A"))
    return colored


def save_optimized(im, path):
    """Palette-quantize (alpha-safe) to keep the preloaded textures small."""
    quantized = im.quantize(colors=256, method=Image.FASTOCTREE)
    quantized.save(path, optimize=True)


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    basename = sys.argv[3] if len(sys.argv) > 3 else None
    im = Image.open(src).convert("RGB")
    box = measure(im)
    print(f"hole bbox: {box}, rails L={box[0]} T={box[1]} R={im.size[0]-box[2]} B={im.size[1]-box[3]}")

    sliced = nine_slice(im, box)
    if basename:
        save_optimized(sliced, f"{out_dir}/{basename}.png")
        print(f"saved {basename}.png")
        return

    save_optimized(sliced, f"{out_dir}/frame-walnut.png")

    oak = recolor(sliced, black=(64, 42, 24), mid=(152, 106, 62), white=(228, 192, 148))
    save_optimized(oak, f"{out_dir}/frame-oak.png")

    black = recolor(sliced, black=(7, 7, 7), mid=(36, 36, 36), white=(96, 96, 96))
    save_optimized(black, f"{out_dir}/frame-black.png")
    print("saved frame-walnut.png / frame-oak.png / frame-black.png")


if __name__ == "__main__":
    main()
