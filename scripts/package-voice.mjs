import { build } from 'esbuild';
import { mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createNoteKnowledge } from '../server/note-reference.mjs';
const root=resolve(import.meta.dirname,'..');
const out=resolve(root,'.aws-build/voice');
// Missing or malformed reference data must never silently replace the deployed corpus.
const articlePath=resolve(root,'server/data/note-articles.json');
let articles;
try { articles=JSON.parse(await readFile(articlePath,'utf8')); }
catch { throw new Error('Prepare the reviewed public note snapshot at server/data/note-articles.json before packaging. See server/README.md.'); }
createNoteKnowledge(articles);
await rm(out,{recursive:true,force:true});
await rm(resolve(root,'.aws-build/voice.zip'),{force:true});
await mkdir(resolve(out,'src'),{recursive:true});
await mkdir(resolve(out,'server/data'),{recursive:true});
await build({entryPoints:[resolve(root,'server/aws/runtime.mjs')],outfile:resolve(out,'runtime.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',plugins:[{name:'preserve-prompt-path',setup(b){b.onResolve({filter:/^\.\.\/voice\.mjs$/},()=>({path:'./server/voice.mjs',external:true}));}}],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
await copyFile(resolve(root,'server/voice.mjs'),resolve(out,'server/voice.mjs'));
await copyFile(resolve(root,'server/note-reference.mjs'),resolve(out,'server/note-reference.mjs'));
await copyFile(articlePath,resolve(out,'server/data/note-articles.json'));
await copyFile(resolve(root,'src/works.json'),resolve(out,'src/works.json'));
// Enumerated archive entries: no .env, source maps or unrelated repository files.
execFileSync('zip',['-q','../voice.zip','runtime.mjs','server/voice.mjs','server/note-reference.mjs','server/data/note-articles.json','src/works.json'],{cwd:out});
console.log('Created .aws-build/voice.zip');
