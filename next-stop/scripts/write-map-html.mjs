// Writes public/map.html (the website's sandboxed map frame) from src/components/mapHtml.ts.
import { writeFileSync } from 'node:fs';
import { MAP_HTML } from '../src/components/mapHtml.ts';
writeFileSync(new URL('../public/map.html', import.meta.url), MAP_HTML);
console.log('public/map.html written');
