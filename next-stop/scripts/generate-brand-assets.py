"""Generates every NEXT STOP logo/icon asset from the approved artwork.

Source: assets/brand/next-stop-logo-source.png (the supplied approved logo, unmodified).
Run:    python scripts/generate-brand-assets.py   (needs Pillow)

The artwork's warm-white background is removed by un-blending each pixel against the
background colour, so antialiased edges stay smooth. Shapes are only cropped and scaled
uniformly; nothing is redrawn.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
BG = (254, 250, 244)  # artwork background, measured from the source corners
WARM_WHITE = '#FEFAF4'
INKS = [(239, 81, 58), (19, 38, 61)]  # coral, midnight navy (measured from the artwork)
SYMBOL_MAX_X = 700  # the coral N/pin symbol sits left of the wordmark (bbox x 142-628)


def unblend(img):
    """Background -> transparent. The artwork is flat colour, so each pixel is assigned to
    its nearest ink and its alpha is how far it lies between the background and that ink.
    Grain lighter than the background is ignored, so the result is clean on any colour."""
    src = img.convert('RGB')
    out = Image.new('RGBA', src.size)
    sp, op = src.load(), out.load()
    vectors = [(ink, [ink[i] - BG[i] for i in range(3)]) for ink in INKS]
    for y in range(src.height):
        for x in range(src.width):
            p = sp[x, y]
            d = [p[i] - BG[i] for i in range(3)]
            best = None
            for ink, v in vectors:
                t = sum(d[i] * v[i] for i in range(3)) / sum(c * c for c in v)
                t = max(0.0, min(1.0, t))
                residual = sum((d[i] - t * v[i]) ** 2 for i in range(3))
                if best is None or residual < best[2]:
                    best = (ink, t, residual)
            ink, a, _ = best
            op[x, y] = (*ink, 0) if a < 0.06 else (*ink, round(a * 255))
    return out


def bbox(img, max_x=None):
    region = img if max_x is None else img.crop((0, 0, max_x, img.height))
    return region.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()


def fit(img, size, fraction, background=None):
    """Centre `img` on a square canvas so its longest side is `fraction` of the canvas."""
    canvas = Image.new('RGBA', (size, size), background or (0, 0, 0, 0))
    scale = size * fraction / max(img.size)
    resized = img.resize(
        (round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS
    )
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main():
    logo = unblend(Image.open(ASSETS / 'brand' / 'next-stop-logo-source.png'))
    full = logo.crop(bbox(logo))
    symbol = logo.crop(bbox(logo, SYMBOL_MAX_X))

    # Full wordmark for in-app headers: transparent, proportions unchanged.
    pad = 12
    wordmark = Image.new('RGBA', (full.width + 2 * pad, full.height + 2 * pad), (0, 0, 0, 0))
    wordmark.alpha_composite(full, (pad, pad))
    target_w = 1200
    wordmark.resize(
        (target_w, round(wordmark.height * target_w / wordmark.width)), Image.Resampling.LANCZOS
    ).save(ASSETS / 'brand' / 'next-stop-wordmark.png', optimize=True)
    # Compact mark (transparent square).
    fit(symbol, 512, 0.92).save(ASSETS / 'brand' / 'next-stop-symbol.png', optimize=True)
    # App icon: opaque warm-white tile (iOS icons cannot be transparent).
    fit(symbol, 1024, 0.64, WARM_WHITE).convert('RGB').save(ASSETS / 'icon.png', optimize=True)
    # Android adaptive foreground: transparent, inside the 66% safe zone.
    fit(symbol, 1024, 0.56).save(ASSETS / 'adaptive-icon.png', optimize=True)
    # Splash image, shown on the warm-white splash background.
    fit(symbol, 1024, 0.9).save(ASSETS / 'splash-icon.png', optimize=True)
    # Web favicon.
    fit(symbol, 196, 0.8, WARM_WHITE).save(ASSETS / 'favicon.png', optimize=True)
    # Android notification icon: single-colour white silhouette of the symbol.
    white = Image.new('RGBA', symbol.size, (255, 255, 255, 255))
    white.putalpha(symbol.getchannel('A'))
    fit(white, 96, 0.86).save(ASSETS / 'location-notification.png', optimize=True)
    print('Generated wordmark, symbol, icon, adaptive icon, splash, favicon, notification icon.')


if __name__ == '__main__':
    main()
