// main.ts — driver for the markdown-render-speed-02 entry.
// It reads every case from MAKEFUN_INPUT_DIR/cases.json, renders each one
// alone with parse from parse.js, and writes the HTML strings in order to
// MAKEFUN_OUTPUT_DIR/html.json. Node 22, built-in modules only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const html = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
