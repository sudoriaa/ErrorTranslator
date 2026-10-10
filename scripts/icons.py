"""Generate the extension's original E / arrow mark as PNGs; no external assets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
root.mkdir(parents=True, exist_ok=True)
scale = 4
image = Image.new('RGBA', (128*scale, 128*scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 128*scale-1, 128*scale-1), radius=31*scale, fill='#cc654c')
# Draw a geometric E and a rising arrow so no system font is required.
for rect in [(30,33,43,98),(42,33,84,46),(42,59,76,72),(42,85,84,98)]:
    draw.rectangle(tuple(v*scale for v in rect), fill='white')
draw.line([(84*scale,34*scale),(102*scale,16*scale)], fill='white', width=7*scale)
draw.line([(86*scale,16*scale),(102*scale,16*scale),(102*scale,32*scale)], fill='white', width=7*scale)
for size in (16,32,48,128):
    image.resize((size,size), Image.Resampling.LANCZOS).save(root / f'icon{size}.png')
print('Generated extension icons.')
