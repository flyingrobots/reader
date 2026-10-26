// Third-party license retention for the web bundle: only packages whose code reaches an output
// keep a license copy and a build-meta entry, and the license folder is rebuilt from scratch.
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

// esbuild's metafile `inputs` lists every file it read, including packages tree shaking drops
// entirely; `outputs[*].inputs[*].bytesInOutput` says which of them actually ship.
export function shippedInputs(metafiles){
  const kept=new Set();
  for(const metafile of metafiles)for(const output of Object.values(metafile.outputs))
    for(const [path,{bytesInOutput}] of Object.entries(output.inputs))if(bytesInOutput>0)kept.add(path);
  return [...kept].sort();
}

const named=dir=>existsSync(join(dir,'package.json'))&&!!JSON.parse(readFileSync(join(dir,'package.json'),'utf8')).name;

// The package root of a node_modules input. Nested {"type":"module"} markers (dist/esm/package.json)
// have no name, so the walk continues to the folder whose package.json names the package.
export function packageRoot(input){
  let folder=dirname(input);
  while(folder!=='.'&&folder!=='/'&&!named(folder))folder=dirname(folder);
  if(folder==='.'||folder==='/')throw new Error('Missing package metadata: '+input);
  return folder;
}

// Replace `dir` with the license files of `folders` (package roots) plus `extra` {name: path}
// copies; returns the sorted {name: {version, license}} map for build-meta.json.
export function writeLicenses(dir,folders,extra={}){
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  const packages=new Map();
  for(const folder of folders){
    const pkg=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
    if(packages.has(pkg.name))continue;
    const licenses=readdirSync(folder).filter(name=>/^licen[cs]e(?:\.|$)/i.test(name));
    if(!licenses.length)throw new Error('Missing license: '+pkg.name);
    for(const license of licenses)writeFileSync(join(dir,pkg.name.replaceAll('/','-')+'-'+license),readFileSync(join(folder,license)));
    packages.set(pkg.name,{version:pkg.version,license:pkg.license});
  }
  for(const [name,path] of Object.entries(extra))writeFileSync(join(dir,name),readFileSync(path));
  return Object.fromEntries([...packages].sort());
}
