import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
async function walk(directory) {
  const entries=await readdir(directory,{withFileTypes:true});
  return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(resolve(directory,entry.name)):[resolve(directory,entry.name)]))).flat();
}
const files=await walk('extension');
let failed=false;
for(const file of files.filter(file=>file.endsWith('.js'))) {
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0) {failed=true;process.stderr.write(result.stderr);}
}
const manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
for(const path of [manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,...Object.values(manifest.icons)]) {
  if(!files.includes(resolve('extension',path))) {failed=true;console.error(`Missing manifest resource: ${path}`);}
}
for(const file of files.filter(file=>file.endsWith('.html'))) {
  const html=await readFile(file,'utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if(/^(https?:|data:)/.test(match[1])) continue;
    if(!files.includes(resolve('extension',match[1]))) {failed=true;console.error(`Missing HTML resource: ${match[1]}`);}
  }
}
if(failed) process.exit(1);
console.log(`Checked ${files.length} extension resources: syntax and manifest links passed.`);
