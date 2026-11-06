# NEXT STOP visual identity

**Your ride. In sight.**

The approved logo is a coral N drawn as a transit path, ending in a station node and a location pin, beside the NEXT STOP wordmark and tagline. The full wordmark appears wherever the app shows its full logo; the coral N/pin symbol alone is the compact mark and the app icon.

| Token         | Value     | Purpose                                       |
| ------------- | --------- | --------------------------------------------- |
| Midnight navy | `#11243A` | Identity, headings, driver workspace emphasis |
| Coral         | `#EF543F` | Primary action and route highlight            |
| Mint          | `#DDF1E8` | Positive status surfaces                      |
| Forest        | `#177754` | Status text on mint                           |
| Paper         | `#F5F7F8` | Main background                               |
| Slate         | `#72808D` | Supporting copy                               |

System typography keeps native rendering fast and avoids font-loading dependencies. Strong headings, large tap targets, generous spacing, and plain status language guide the interface. Status meaning always appears in text as well as color. Contrast and screen-reader flow still require an accessibility audit before launch.

Source artwork (approved, unmodified): `assets/brand/next-stop-logo-source.png` (warm-white `#FEFAF4` background; inks coral `#EF513A`, navy `#13263D`). `scripts/generate-brand-assets.py` derives every asset from it by cropping and uniform scaling only; the background becomes transparent using the two flat ink colours, so edges stay clean on any surface:

| File                                  | Use                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `assets/brand/next-stop-wordmark.png` | Full logo in the app (`Brand` in `src/components/Brand.tsx`), light backgrounds only |
| `assets/brand/next-stop-symbol.png`   | Compact mark (`Mark`)                                                                |
| `assets/icon.png`                     | App icon: symbol on warm white (opaque, required by iOS)                             |
| `assets/adaptive-icon.png`            | Android adaptive foreground, inside the safe zone; background `#FEFAF4`              |
| `assets/splash-icon.png`              | Splash image on `#FEFAF4`                                                            |
| `assets/favicon.png`                  | Web                                                                                  |
| `assets/location-notification.png`    | Android notification/tracking icon (white silhouette)                                |

Do not stretch, recolour or redraw the artwork. Keep clear space of at least the pin head's width around it. The navy wordmark text is for light backgrounds; on dark surfaces use the coral symbol alone.

Institutions should have their own name/logo context while NEXT STOP retains the app's primary identity. Institution branding customization is a next milestone, not a completed settings feature. Brand and trademark availability have not been verified.
