import {cpSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

mkdirSync(dist, {recursive: true});
for (const file of ['index.html', 'screenshot.svg']) {
  cpSync(resolve(root, 'docs', file), resolve(dist, file));
}

console.log('[build] copied Pages landing page assets into dist/');
