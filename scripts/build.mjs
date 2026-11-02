import { build } from 'esbuild';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
let previous = {};
try { previous = JSON.parse(await readFile(resolve(root, 'reports/build.json'), 'utf8')).outputs || {}; } catch {}
const result = await build({
  absWorkingDir: root, entryPoints: ['src/app.js', 'src/styles.css'], outdir: 'assets/build',
  bundle: true, splitting: true, format: 'esm', target: ['es2022', 'safari16'], minify: true,
  entryNames: '[name]-[hash]', chunkNames: '[name]-[hash]', metafile: true,
});
const entry = name => './' + Object.entries(result.metafile.outputs).find(([, v]) => v.entryPoint === name)[0];
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const works = JSON.parse(await readFile(resolve(root, 'src/works.json'), 'utf8'));
const cards = works.map((w, i) => {
  const list = w.images.filter(image => image.width <= 800);
  const image = list.at(-1);
  const sizes = `(max-width: 900px) calc(100vw - 72px), calc((100vw - 210px) / 2 - 48px)`;
  return `<article class="work ${i === 0 ? 'featured' : ''}" id="${w.id}"><a class="work-link" href="${escape(w.link)}" data-work="detail-${w.id}" id="toggle-${w.id}"><picture><img src="${image.src}" srcset="${list.map(im => `${im.src} ${im.width}w`).join(', ')}" sizes="${sizes}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async" alt="${escape(w.title)}" style="object-position:${w.anchor}"></picture><div class="caption"><h3 class="work-name"><span>${escape(w.title)}</span><span class="work-toggle-icon" aria-hidden="true">+</span></h3><p class="work-summary" data-ja="${escape(w.summaryJa)}" data-en="${escape(w.summaryEn)}">${escape(w.summaryJa)}</p></div></a></article>`;
}).join('\n');
const details = works.map(w => {
  return `<template id="detail-${w.id}"><div class="detail-content"><div class="detail-description" data-lang-content="ja">${w.descriptionJa}</div><div class="detail-description" data-lang-content="en" hidden>${w.descriptionEn}</div><p class="detail-meta">${escape(w.category)}</p><div class="detail-actions"><a class="detail-link" href="${escape(w.link)}" target="_blank" rel="noopener noreferrer">${escape(w.linkLabel)} ↗</a><button type="button" class="work-close"><span data-ja="閉じる" data-en="Close">閉じる</span><span aria-hidden="true">−</span></button></div></div></template>`;
}).join('\n');
let html = await readFile(resolve(root, 'src/index.template.html'), 'utf8');
html = html.replace('__WORKS__', cards).replace('__DETAILS__', details).replace('__JS__', entry('src/app.js')).replace('__CSS__', entry('src/styles.css'));
await writeFile(resolve(root, 'index.html'), html);
await mkdir(resolve(root, 'reports'), { recursive: true });
await writeFile(resolve(root, 'reports/build.json'), JSON.stringify(result.metafile, null, 2) + '\n');
// Remove only obsolete files listed in the previous build manifest.
for (const file of Object.keys(previous)) {
  if (file.startsWith('assets/build/') && !result.metafile.outputs[file]) await unlink(resolve(root, file)).catch(() => {});
}
console.log('Built static index.html. No server is required for deployment.');
