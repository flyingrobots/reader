import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const out='../src/reader_mcp/web_ui/controls';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
mkdirSync(out,{recursive:true});
const result=await build({entryPoints:{'reader-controls':'src/reader-controls.tsx'},bundle:true,format:'esm',target:'es2022',minify:true,jsx:'automatic',outdir:out,entryNames:'[name]',define:{'process.env.NODE_ENV':'"production"'},metafile:true,legalComments:'linked'});
// Three.js entries: the page turn, article art and the article-shape data view load on demand and share one Three.js chunk
// under controls/three/. Stale chunks are removed.
rmSync(out+'/three',{recursive:true,force:true});for(const name of ['page-turn','shape','art'])rmSync(out+'/'+name+'.js.LEGAL.txt',{force:true});
const three=await build({entryPoints:{'page-turn':'src/page-turn/page-turn.ts',shape:'src/shape/shape.ts',art:'src/art/art.ts'},bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,outdir:out,entryNames:'[name]',chunkNames:'three/[name]-[hash]',metafile:true,legalComments:'linked'});
// Diagrams: an on-demand entry whose diagram types are split into their own chunks under
// controls/diagrams/, so a document loads only the renderers it uses. Stale chunks are removed.
rmSync(out+'/diagrams',{recursive:true,force:true});
const diagrams=await build({entryPoints:{diagrams:'src/diagrams.ts'},bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,outdir:out,entryNames:'[name]',chunkNames:'diagrams/[name]-[hash]',metafile:true,legalComments:'linked'});
// Math: KaTeX as an on-demand entry; its stylesheet and woff2 fonts (only woff2) under controls/katex/.
const math=await build({entryPoints:{math:'src/math.ts'},bundle:true,format:'esm',target:'es2022',minify:true,outdir:out,entryNames:'[name]',metafile:true,legalComments:'linked'});
rmSync(out+'/katex',{recursive:true,force:true});mkdirSync(out+'/katex/fonts',{recursive:true});
const katexDist='node_modules/katex/dist';
writeFileSync(out+'/katex/katex.css',readFileSync(katexDist+'/katex.min.css','utf8').replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g,''));
for(const font of readdirSync(katexDist+'/fonts').filter(name=>name.endsWith('.woff2')))writeFileSync(out+'/katex/fonts/'+font,readFileSync(katexDist+'/fonts/'+font));
// Code highlighting: Shiki (JavaScript regex engine, no WebAssembly) as an on-demand entry whose
// grammars are split into their own chunks under controls/highlight/, one per language. Stale chunks are removed.
rmSync(out+'/highlight',{recursive:true,force:true});
const highlight=await build({entryPoints:{highlight:'src/code-highlight.ts'},bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,outdir:out,entryNames:'[name]',chunkNames:'highlight/[name]-[hash]',metafile:true,legalComments:'linked'});
// Editor: the CodeMirror 6 Markdown editor with Vim keys, loaded only when a scratch buffer opens.
const editor=await build({entryPoints:{editor:'src/markdown-editor.ts'},bundle:true,format:'esm',target:'es2022',minify:true,outdir:out,entryNames:'[name]',metafile:true,legalComments:'linked'});
const inputs=[...Object.keys(result.metafile.inputs),...Object.keys(three.metafile.inputs),...Object.keys(diagrams.metafile.inputs),...Object.keys(math.metafile.inputs),...Object.keys(highlight.metafile.inputs),...Object.keys(editor.metafile.inputs)];
// Famous themes: resolve palettes to tokens with the same code the editor uses.
mkdirSync('node_modules/.cache',{recursive:true});
await build({entryPoints:['src/theme/famous-build.ts'],bundle:true,format:'esm',platform:'node',target:'es2022',outfile:'node_modules/.cache/famous-build.mjs',logLevel:'error'});
const {famousStylesheet}=await import(new URL('./node_modules/.cache/famous-build.mjs?'+Date.now(),import.meta.url));
writeFileSync(out+'/famous-themes.css',famousStylesheet().css);
execFileSync('node_modules/.bin/tailwindcss',['-i','src/styles.css','-o',out+'/reader-controls.css','--minify'],{stdio:'inherit'});
const packages=new Map();
function retainPackage(folder){
  const pkg=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
  if(packages.has(pkg.name))return;
  const licenses=readdirSync(folder).filter(name=>/^licen[cs]e(?:\.|$)/i.test(name));
  if(!licenses.length)throw new Error('Missing license: '+pkg.name);
  mkdirSync(out+'/licenses',{recursive:true});
  for(const license of licenses)writeFileSync(out+'/licenses/'+pkg.name.replaceAll('/','-')+'-'+license,readFileSync(join(folder,license)));
  packages.set(pkg.name,{version:pkg.version,license:pkg.license});
}
for(const input of [...new Set(inputs)].filter(p=>p.includes('node_modules/'))){
  let folder=dirname(input);
  // Skip nested {"type":"module"} markers (dist/esm/package.json): the package root has a name.
  const named=dir=>existsSync(join(dir,'package.json'))&&!!JSON.parse(readFileSync(join(dir,'package.json'),'utf8')).name;
  while(folder!=='.'&&!named(folder))folder=dirname(folder);
  if(folder==='.')throw new Error('Missing package metadata: '+input);
  retainPackage(folder);
}
for(const name of ['tailwindcss','tw-animate-css'])retainPackage('node_modules/'+name);
writeFileSync(out+'/licenses/shadcn-ui-LICENSE',readFileSync('LICENSE.shadcn-ui'));
const sources=Object.fromEntries([...new Set(inputs.filter(p=>!p.includes('node_modules/'))),'src/styles.css','src/theme/famous-build.ts','src/theme/famous.ts','../src/reader_mcp/web_ui/famous-themes.json','package-lock.json','components.json','build.mjs'].sort().map(path=>[path,hash(path)]));
const outputs={};
function collect(folder){for(const file of readdirSync(folder,{withFileTypes:true})){const path=join(folder,file.name);if(file.isDirectory())collect(path);else if(file.name!=='build-meta.json')outputs[path.slice(out.length+1)]={bytes:readFileSync(path).length,sha256:hash(path)};}}
collect(out);
writeFileSync(out+'/build-meta.json',JSON.stringify({registry:{name:'shadcn/ui',cli:'4.22.1',style:'base-nova',url:'https://ui.shadcn.com'},sources,dependencies:Object.fromEntries([...packages].sort()),outputs},null,2)+'\n');
