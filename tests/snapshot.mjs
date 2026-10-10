import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Optional private regression: source stays outside the repository and is never
// sent to a translator. Only public GitHub CSS may load; all scripts are removed.
if(!process.argv[2]) throw new Error('Provide an HTML snapshot path.');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
let styles=0,failedStyles=0;
try {
  await mkdir('test-results',{recursive:true});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.resourceType()==='stylesheet' && url.hostname==='github.githubassets.com') {
      try {const response=await route.fetch({timeout:12000});if(response.ok()) styles++;else failedStyles++;await route.fulfill({response});}
      catch {failedStyles++;await route.abort();}
    } else await route.abort();
  });
  const html=await page.evaluate(source=>{
    const doc=new DOMParser().parseFromString(source,'text/html');
    doc.querySelectorAll('script,iframe,meta[http-equiv],link:not([rel="stylesheet"])').forEach(node=>node.remove());
    for(const element of doc.querySelectorAll('*')) for(const attr of [...element.attributes]) if(attr.name.startsWith('on')) element.removeAttribute(attr.name);
    return doc.documentElement.outerHTML;
  },await readFile(process.argv[2],'utf8'));
  await page.setContent(html,{waitUntil:'load',timeout:30000});
  assert.ok(styles>0,'Snapshot must load its actual page CSS');
  const before=await page.evaluate(()=>{
    window.checkedControls=[...document.querySelectorAll('button,[role="button"],nav a,header a')].filter(node=>node.getClientRects().length && node.innerText.trim() && node.getBoundingClientRect().height<100);
    return window.checkedControls.map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height};});
  });
  await page.screenshot({path:'test-results/snapshot-before.png',fullPage:true});
  await page.evaluate(()=>{window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async message=>message.type==='ET_CANCEL'?{ok:true}:{ok:true,translations:message.segments.map(s=>({id:s.id,text:/^[\p{L}\s]+$/u.test(s.text)?`译${s.text}`:s.text}))}}};});
  await page.addScriptTag({path:'extension/src/content/dom.js'});await page.addScriptTag({path:'extension/src/content/controller.js'});
  await page.evaluate(()=>window.__errorTranslator.start({mode:'bilingual',target:'zh-CN',dynamic:false,batchSize:16}));
  await page.waitForFunction(()=>window.__errorTranslator.getState().status==='ready');
  const after=await page.evaluate(()=>window.checkedControls.map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height};}));
  const changes=after.flatMap((r,i)=>Math.abs(r.width-before[i].width)>2 || Math.abs(r.height-before[i].height)>2?[{i,before:before[i],after:r}]:[]);
  await page.screenshot({path:'test-results/snapshot-after.png',fullPage:true});
  assert.deepEqual(changes,[],'Snapshot control sizes must be preserved');
  await page.evaluate(()=>window.__errorTranslator.restore());
  assert.equal(await page.locator('[data-error-translator]').count(),0);
  console.log(`PASS: private HTML snapshot, ${styles} styles loaded (${failedStyles} unavailable), ${before.length} control sizes and restoration`);
} finally {await browser.close();}
