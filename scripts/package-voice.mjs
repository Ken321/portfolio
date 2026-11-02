import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=resolve(root,'.aws-build/voice');
await mkdir(resolve(out,'src'),{recursive:true});
await mkdir(resolve(out,'server'),{recursive:true});
await build({entryPoints:[resolve(root,'server/aws/runtime.mjs')],outfile:resolve(out,'runtime.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',plugins:[{name:'preserve-prompt-path',setup(b){b.onResolve({filter:/^\.\.\/voice\.mjs$/},()=>({path:'./server/voice.mjs',external:true}));}}],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
await copyFile(resolve(root,'server/voice.mjs'),resolve(out,'server/voice.mjs'));
await copyFile(resolve(root,'src/works.json'),resolve(out,'src/works.json'));
// Enumerated archive entries: no .env, source maps or unrelated repository files.
execFileSync('zip',['-q','../voice.zip','runtime.mjs','server/voice.mjs','src/works.json'],{cwd:out});
console.log('Created .aws-build/voice.zip');
