# NEXT STOP visual identity

**Your ride. In sight.**

The N follows a continuous transit path, with two station nodes as its endpoints. It works as a compact app mark without relying on any institution's mascot. The app uses a flat, reproducible vector version; a separate generated concept board illustrates the wider direction.

| Token         | Value     | Purpose                                       |
| ------------- | --------- | --------------------------------------------- |
| Midnight navy | `#11243A` | Identity, headings, driver workspace emphasis |
| Coral         | `#EF543F` | Primary action and route highlight            |
| Mint          | `#DDF1E8` | Positive status surfaces                      |
| Forest        | `#177754` | Status text on mint                           |
| Paper         | `#F5F7F8` | Main background                               |
| Slate         | `#72808D` | Supporting copy                               |

System typography keeps native rendering fast and avoids font-loading dependencies. Strong headings, large tap targets, generous spacing, and plain status language guide the interface. Status meaning always appears in text as well as color. Contrast and screen-reader flow still require an accessibility audit before launch.

Editable mark: `assets/brand/next-stop-mark.svg`. In-app mark: `src/components/Brand.tsx`. Raster assets: `assets/icon.png`, `assets/adaptive-icon.png`, `assets/favicon.png`; regeneration script uses Pillow. Keep at least one endpoint-circle diameter of clear space around the mark.

Institutions should have their own name/logo context while NEXT STOP retains the app's primary identity. Institution branding customization is a next milestone, not a completed settings feature. Brand and trademark availability have not been verified.
