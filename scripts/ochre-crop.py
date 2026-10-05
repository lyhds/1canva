"""Deterministic detail crop. Usage: ochre-crop.py SOURCE DEST x y width height."""
import hashlib
import json
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 7:
        raise ValueError(__doc__)
    from PIL import Image, ImageOps
    source, dest = map(Path, sys.argv[1:3])
    x, y, width, height = map(int, sys.argv[3:])
    sidecar = Path(str(dest) + '.json')
    if dest.exists() or sidecar.exists():
        raise ValueError('Output already exists; use a new version filename')
    if dest.suffix.lower() != '.png':
        raise ValueError('Detail output must be PNG')
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        if min(x, y) < 0 or min(width, height) <= 0 or x + width > image.width or y + height > image.height:
            raise ValueError('Crop must stay inside the oriented master image')
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open('xb') as output:
            image.crop((x, y, x + width, y + height)).save(output, format='PNG')
    with sidecar.open('x') as output:
        json.dump({'method': 'crop', 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
                   'outputSHA256': hashlib.sha256(dest.read_bytes()).hexdigest(),
                   'box': [x, y, width, height], 'coordinates': 'EXIF-oriented pixels'}, output, indent=2)
    print(dest)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
