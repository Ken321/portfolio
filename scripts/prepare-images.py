"""Regenerate responsive WebP images: python3 scripts/prepare-images.py [source-root].
Requires Pillow. Original project images are never modified.
"""
from pathlib import Path
from PIL import Image, ImageOps
import hashlib, json, sys
root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root
out = root / 'assets/images'
out.mkdir(parents=True, exist_ok=True)
works = json.loads((root / 'src/works.json').read_text())
for work in works:
    image = ImageOps.exif_transpose(Image.open(source / work['image'])).convert('RGB')
    variants = []
    for width in sorted(set(min(w, image.width) for w in (400, 800, 1280))):
        resized = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
        from io import BytesIO
        buffer = BytesIO()
        resized.save(buffer, format='WEBP', quality=82, method=6)
        data = buffer.getvalue()
        filename = f"{Path(work['image']).stem}-{width}-{hashlib.sha256(data).hexdigest()[:8]}.webp"
        (out / filename).write_bytes(data)
        variants.append({'src':f'./assets/images/{filename}', 'width':width, 'height':resized.height, 'bytes':len(data)})
    work['images'] = variants
(root / 'src/works.json').write_text(json.dumps(works, ensure_ascii=False, indent=2) + '\n')
print('Responsive images:', sum(len(w['images']) for w in works))
print('Largest-list variants:', sum(next((i['bytes'] for i in w['images'] if i['width'] >= 800), w['images'][-1]['bytes']) for w in works))
