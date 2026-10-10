import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1320,height:960}});
await mkdir('test-results',{recursive:true});
try {
  await page.setContent(await readFile('tests/layout-fixture.html','utf8'));
  await page.evaluate(()=>{
    const button=document.createElement('button');button.id='mixed-label';button.className='btn';button.innerHTML='Open <span class="icon"></span> menu';document.querySelector('.toolbar').append(button);
    const row=document.createElement('div');row.className='row';row.innerHTML='<h2 id="nested-heading"><div style="display:flex">Section heading</div></h2><button class="btn">View all</button>';document.querySelector('.prose').prepend(row);
    const regression=document.createElement('section');regression.id='layout-edge-cases';
    regression.innerHTML='<style>#hostile span{padding:32px!important;min-width:220px!important;min-height:120px!important;margin:22px!important;border:8px solid red!important}#hostile et-translation,#hostile et-source-slot,#hostile et-source{padding:40px!important;min-width:250px!important;min-height:150px!important}#edge-flex{display:flex;gap:10px}#edge-flex>div{width:50px;flex-shrink:0}#edge-grid{display:grid;grid-template-columns:55px 55px;gap:8px}.edge-inline{display:inline-block;width:55px}</style><div id="hostile"><button class="btn" id="hostile-button">Small label</button><p id="hostile-prose">A short sentence.</p></div><div id="edge-flex"><div id="narrow-flex">Status</div><div id="narrow-flex-two">Details</div></div><div id="edge-grid"><div id="narrow-grid">Status</div><div>Details</div></div><div class="edge-inline" id="edge-inline">Status</div><div id="whitespace-prose" style="width:260px">\n     First line of a paragraph\n          with indenting from the HTML source\n       and extra whitespace.\n     </div>';
    document.querySelector('.prose').append(regression);
    const metadata=document.createElement('div');metadata.id='repo-metadata';metadata.style.cssText='margin-top:12px;line-height:24px;width:700px;max-width:100%;';
    metadata.innerHTML=`
      <span id="meta-language" style="margin-right:16px">Go</span>


      <span id="meta-license" style="margin-right:16px">GNU Affero General Public License v3.0</span>


      <span id="meta-updated">Updated 19 hours ago</span>
    `;
    document.querySelector('.prose').append(metadata);
  });
  await page.evaluate(()=>{
    const listeners=[];
    window.chrome={runtime:{onMessage:{addListener:listener=>listeners.push(listener)},sendMessage:async message=>{
      if(message.type==='ET_CANCEL') return {ok:true};
      const metadata={'GNU Affero General Public License v3.0':'GNU Affero 通用公共许可证 v3.0','Updated 19 hours ago':'更新于 19 小时前'};
      return {ok:true,translations:message.segments.map(s=>({id:s.id,text:['GitHub','Go'].includes(s.text.trim())?s.text:metadata[s.text.trim()] || (['Status','Details'].includes(s.text.trim())?'这里是一段较长的状态说明译文，用来检查窄标签是否会被撑成很高的一列':`译${s.text}`)})).reverse()};
    }}};
    window.linkNode=document.querySelector('#article-link');window.originalButton=document.querySelector('#menu');window.clicks=0;window.originalButton.addEventListener('click',()=>window.clicks++);
  });
  await page.addScriptTag({path:'extension/src/content/dom.js'});await page.addScriptTag({path:'extension/src/content/controller.js'});
  await page.locator('.card .badge').evaluateAll(nodes=>nodes.forEach((node,i)=>node.id=`badge-${i}`));
  const ids=['header','main','nav','menu','mixed-label','create','profile','home','issues','pulls','explore','fixed','cards','card-one','card-two','card-three','grid-a','grid-b','grid-c','badge-0','badge-1','badge-2','hostile-button','narrow-flex','narrow-flex-two','narrow-grid','edge-inline','repo-metadata'];
  const measure=()=>page.evaluate(ids=>Object.fromEntries(ids.map(id=>{const box=document.getElementById(id).getBoundingClientRect();return [id,{x:box.x,y:box.y,width:box.width,height:box.height}];})),ids);
  const before=await measure();await page.screenshot({path:'test-results/layout-before.png',fullPage:true});
  await page.evaluate(()=>window.__errorTranslator.start({mode:'bilingual',target:'zh-CN',dynamic:false,providerType:'ai',batchSize:16}));
  await page.waitForFunction(()=>window.__errorTranslator.getState().status==='ready');
  const after=await measure();
  for(const id of ['header','menu','mixed-label','create','profile','home','issues','pulls','explore','fixed','badge-0','badge-1','badge-2']) {
    for(const dimension of ['x','y','width','height']) assert.ok(Math.abs(after[id][dimension]-before[id][dimension])<1.5,`${id} ${dimension}: ${before[id][dimension]} -> ${after[id][dimension]}`);
  }
  for(const id of ['main','cards','card-one','card-two','card-three','grid-a','grid-b','grid-c']) {
    assert.ok(Math.abs(after[id].width-before[id].width)<1.5,`${id}: width changed`);
  }
  for(const id of ['hostile-button','narrow-flex','narrow-flex-two','narrow-grid','edge-inline','repo-metadata']) {
    for(const dimension of ['width','height']) assert.ok(Math.abs(after[id][dimension]-before[id][dimension])<1.5,`${id} ${dimension}: ${before[id][dimension]} -> ${after[id][dimension]}`);
  }
  assert.equal(await page.locator('#hostile-prose [data-error-translator="translation"]').evaluate(host=>getComputedStyle(host).paddingTop),'0px');
  assert.ok(await page.locator('#hostile-prose').evaluate(node=>node.getBoundingClientRect().height)<60,'Site span styles must not inflate translations');
  assert.ok(await page.locator('#whitespace-prose').evaluate(node=>node.getBoundingClientRect().height)<150,'HTML formatting whitespace must collapse normally');
  assert.equal(await page.locator('#whitespace-prose [data-error-translator="translation"] .text').evaluate(node=>getComputedStyle(node).whiteSpace),'normal');
  assert.equal(await page.locator('#meta-language [data-error-translator]').count(),0);
  assert.equal(await page.locator('#meta-license [data-error-translator="translation"]').count(),1);
  assert.equal(await page.locator('#meta-updated [data-error-translator="translation"]').count(),1);
  assert.equal(await page.locator('#repo-metadata > [data-error-translator="translation"]').count(),0,'Metadata must not create a giant full-row translation');
  assert.equal(await page.locator('#cards > *').count(),3);assert.equal(await page.locator('#grid-labels > *').count(),3);
  assert.equal(await page.locator('#unchanged [data-error-translator]').count(),0);
  assert.equal(await page.locator('#brand [data-error-translator]').count(),0);
  assert.equal(await page.locator('#short [data-layout="inline"]').count(),1);
  assert.equal(await page.locator('#nested-heading [data-layout="inline"]').count(),1);
  assert.deepEqual(await page.locator('#mixed-label > *').evaluateAll(nodes=>nodes.map(node=>node.dataset.errorTranslator || node.className)),['slot','icon','slot']);
  assert.equal(await page.locator('#long [data-layout="block"]').count(),1);
  assert.equal(await page.locator('#article-link').evaluate(node=>node===window.linkNode),true);
  await page.locator('#menu').click();assert.equal(await page.evaluate(()=>window.clicks),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('[data-error-translator="slot"]')].flatMap(slot=>{
    const host=slot.querySelector('[data-error-translator="translation"]'),text=host.shadowRoot.querySelector('.text');
    const box=slot.getBoundingClientRect(),output=host.getBoundingClientRect(),content=text.getBoundingClientRect();
    return output.right>box.right+1 || output.bottom>box.bottom+1 || content.height>box.height+1 ? [slot.parentElement.id || slot.parentElement.className]:[];
  })),[],'Compact translations must fit inside the original label and remain a single line');
  await page.screenshot({path:'test-results/layout-after.png',fullPage:true});
  await page.evaluate(()=>window.__errorTranslator.restore());
  assert.equal(await page.locator('[data-error-translator]').count(),0);
  assert.equal(await page.locator('#mixed-label').innerHTML(),'Open <span class="icon"></span> menu');
  assert.deepEqual(await measure(),before);
  // Compact UI labels updated by the site remain editable and trigger rescans.
  await page.evaluate(()=>window.__errorTranslator.start({mode:'bilingual',target:'zh-CN',dynamic:true,providerType:'ai'}));
  await page.waitForFunction(()=>window.__errorTranslator.getState().status==='ready');
  await page.locator('#home [data-et-original]').evaluate(node=>node.firstChild.data='New home');
  await page.waitForFunction(()=>document.querySelector('#home [data-error-translator="translation"]')?.shadowRoot.querySelector('.text').textContent==='译New home');
  await page.evaluate(()=>window.__errorTranslator.restore());
  assert.equal(await page.locator('#home').innerText(),'New home');
  console.log('PASS: GitHub layout, repository metadata labels, HTML whitespace, hostile page CSS, narrow containers, geometry and restoration');
} finally {await browser.close();}
