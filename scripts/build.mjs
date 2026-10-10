import {cp,mkdir,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
await mkdir('dist',{recursive:true});
const manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
await cp('extension','dist/error-translator',{recursive:true});
for(const file of ['README.md','LICENSE','PRIVACY.md','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md']) {
  await cp(file,`dist/error-translator/${file}`);
}
await cp('docs','dist/error-translator/docs',{recursive:true});
const source=resolve('dist/error-translator').replaceAll("'","''");
const zipPath=resolve(`dist/error-translator-${manifest.version}.zip`);
const archive=zipPath.replaceAll("'","''");
await rm(zipPath,{force:true});
if(process.platform==='win32') execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${source}', '${archive}')`]);
else execFileSync('zip',['-qr',zipPath,'.'],{cwd:'dist/error-translator'});
console.log(`Built ${manifest.name} ${manifest.version}\n${archive}`);
