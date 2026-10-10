import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,cp,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

const requests=[];
const protocol=process.argv[2]==='responses'?'responses':'ai';
const protocolRequests=[];
let greetingDrafts=0;
let activeParallel=0,maxParallel=0;
const parallelFinished=[];
const mockTranslation=text=>text==='hello world'?'你好世界':`【测试】${text}`;
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  if(req.url==='/v1/models') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'test-translator'},{id:'test-large'}]}));return;}
  if(req.url==='/v1/chat/completions' || req.url==='/v1/responses') {
    let raw='';for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw),responses=req.url==='/v1/responses';
    const input=JSON.parse(responses?body.input[0].content[0].text:body.messages.at(-1).content);requests.push(input);
    protocolRequests.push({url:req.url,body});
    if(input.segments.some(s=>s.text.includes('TRIGGER_FAILURE'))) {res.writeHead(401);res.end('{}');return;}
    if(input.segments.some(s=>s.text.includes('TRIGGER_DELAY'))) await new Promise(r=>setTimeout(r,1300));
    if(input.segments.every(s=>s.text.startsWith('PARALLEL_SEGMENT_'))) {
      maxParallel=Math.max(maxParallel,++activeParallel);
      const index=Number(input.segments[0].text.match(/\d+/)[0]);
      await new Promise(r=>setTimeout(r,1200-index*8));activeParallel--;parallelFinished.push(index);
    }
    if(body.model==='slow-translator') await new Promise(r=>setTimeout(r,32000));
    const review=(responses?body.instructions:body.messages[0].content).includes('DELIVERY REVIEW');
    const translations=input.segments.map(s=>{
      let text=mockTranslation(s.text);
      if(s.text==='hello world' && !review && ++greetingDrafts===1) text='这两个单词的意思是你好世界，是计算机编程初学者常用的文本。';
      if(s.text==='ALWAYS_EXPLAIN') text='作为一个AI，我认为这里需要更多背景解释。';
      return {id:s.id,text};
    }).reverse();
    const text=JSON.stringify({translations});
    const data=responses?{status:'completed',output:[
      {type:'reasoning',summary:[{type:'summary_text',text:'Internal thought must never enter the webpage.'}]},
      {type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'I will now translate and explain the page.'}]},
      {type:'message',role:'assistant',phase:'final_answer',status:'completed',content:[{type:'output_text',text:text.slice(0,20)},{type:'output_text',text:text.slice(20)}]}
    ]}:{choices:[{message:{content:text,reasoning_content:'Internal thought must never enter the webpage.'}}]};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
  }
  try {
    const file=req.url==='/fixture'?'tests/fixture.html':`extension${new URL(req.url,'http://localhost').pathname}`;
    const absolute=resolve(file);
    if(!absolute.startsWith(resolve('extension')) && file!=='tests/fixture.html') throw Error();
    const content=await readFile(absolute);
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[extname(file)] || 'application/octet-stream');res.end(content);
  } catch {res.writeHead(404);res.end('not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
const profile=await mkdtemp(resolve(tmpdir(),'error-translator-test-'));
// A test-only copy pregrants this server's exact origin. Headless Chrome cannot
// interact with the browser's native optional-host permission confirmation.
// All JS/HTML/CSS is the shipped extension; production remains optional-only.
const testExtension=resolve(profile,'extension');
await cp('extension',testExtension,{recursive:true});
const manifest=JSON.parse(await readFile(resolve(testExtension,'manifest.json'),'utf8'));
manifest.host_permissions=[`${base}/*`];
await writeFile(resolve(testExtension,'manifest.json'),JSON.stringify(manifest));
const context=await chromium.launchPersistentContext(resolve(profile,'browser'),{channel:'chromium',headless:true,viewport:{width:1440,height:1050},args:[`--disable-extensions-except=${testExtension}`,`--load-extension=${testExtension}`]});
const errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
try {
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  async function choose(page,id,value) {
    const label=await page.locator(`#${id}`).evaluate((select,value)=>[...select.options].find(option=>option.value===value)?.textContent,value);
    await page.locator(`#${id}-trigger`).click();await page.getByRole('option',{name:label,exact:true}).click();
  }
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForSelector('.preset-card');assert.equal(await options.locator('.preset-card').count(),6);
  await options.screenshot({path:'test-results/settings-empty.png',fullPage:true});
  await options.getByRole('button',{name:'自定义供应商'}).click();
  await choose(options,'provider-type',protocol);
  assert.equal(await options.locator('#model-field').isVisible(),true);
  if(protocol==='responses') assert.match(await options.locator('#url-hint').innerText(),/\/responses/);
  await options.locator('#provider-name').fill('测试翻译');await options.locator('#api-url').fill(`${base}/v1${protocol==='responses'?'/responses':''}`);await options.locator('#model').fill('test-translator');
  await options.getByRole('button',{name:'获取模型'}).click();
  await options.waitForFunction(()=>document.querySelector('#editor-note').textContent.includes('已获取') || document.querySelector('#editor-note').classList.contains('error'));
  assert.match(await options.locator('#editor-note').textContent(),/已获取 2/);
  assert.equal(await options.locator('#model').getAttribute('list'),null);
  await options.locator('#model').focus();await options.locator('#model').fill('test-lar');
  assert.equal(await options.getByRole('option').count(),1);
  await options.locator('#model').press('Enter');assert.equal(await options.locator('#model').inputValue(),'test-large');
  await options.locator('#model').fill('test-translator');await options.locator('#model').press('Escape');
  await options.getByRole('button',{name:'测试连接',exact:true}).click();
  await options.waitForFunction(()=>document.querySelector('#editor-note').textContent.includes('连接成功') || document.querySelector('#editor-note').classList.contains('error'));
  assert.match(await options.locator('#editor-note').textContent(),/连接成功/);
  await options.getByRole('button',{name:'保存连接'}).click();await options.waitForSelector('.saved-provider');
  assert.equal(await options.locator('.saved-provider').count(),1);
  console.log('PASS: extension settings, upstream model list, connection test and provider save');
  const stored=await worker.evaluate(()=>chrome.storage.local.get(['settings','providers']));
  const provider=stored.providers[0];
  const fixture=await context.newPage();await fixture.goto(`${base}/fixture`);await fixture.waitForSelector('#shadow');
  // Chrome storage is private to extension pages and the background.
  assert.equal(await fixture.evaluate(()=>typeof chrome.storage),'undefined');
  await worker.evaluate(async tabUrl=>{
    const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===tabUrl);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/content/dom.js','src/content/controller.js']});
  },`${base}/fixture`);
  const tabId=await worker.evaluate(async tabUrl=>(await chrome.tabs.query({})).find(t=>t.url===tabUrl).id,`${base}/fixture`);
  async function status(forTab=tabId) {return worker.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'ET_STATUS'}),forTab);}
  async function waitReady(forTab=tabId) {
    const deadline=Date.now()+20000;
    while(Date.now()<deadline) {const state=await status(forTab);if(state.status==='error') throw Error(state.error);if(state.status==='ready') return state;await new Promise(r=>setTimeout(r,100));}
    throw Error('Translation timed out');
  }
  async function send(type,settings) {return worker.evaluate(({tabId,type,settings})=>chrome.tabs.sendMessage(tabId,{type,settings}),{tabId,type,settings});}
  assert.equal(provider.type,protocol);
  const settings={...stored.settings,providerId:provider.id,providerType:protocol,dynamic:false};
  await send('ET_START',{...settings,mode:'bilingual'});await waitReady();
  assert.equal(await fixture.locator('#simple').evaluate(e=>e.firstChild.data),'Hello world. A better way to read.');
  assert.equal(await fixture.locator('#simple [data-error-translator]').count(),1);
  assert.equal(await fixture.locator('#inline [data-error-translator]').count(),1);
  assert.equal(await fixture.locator('#mixed > [data-error-translator]').count(),2);
  assert.equal(await fixture.locator('#mixed').evaluate(e=>e.childNodes[1]?.dataset?.errorTranslator),'translation');
  assert.match(await fixture.locator('#mixed > [data-error-translator] .text').first().innerText(),/Before a nested block/);
  assert.match(await fixture.locator('#mixed > [data-error-translator] .text').last().innerText(),/After a nested block/);
  assert.equal(await fixture.locator('#spaced [data-error-translator] .text').innerText(),'【测试】First second!');
  assert.match(await fixture.locator('#inline [data-error-translator] .text').innerText(),/【测试】Read the original article and keep its structure/);
  assert.equal(await fixture.locator('#link').getAttribute('href'),'#simple');
  assert.equal(await fixture.locator('#no-translate [data-error-translator]').count(),0);
  assert.equal(await fixture.locator('#pre').innerText(),'const message = "Do not translate source code";console.log(message);');
  assert.equal(await fixture.locator('#editable').innerText(),'The user is writing here.');
  assert.match(await fixture.frameLocator('#frame').locator('[data-error-translator] .text').innerText(),/【测试】Same origin/);
  assert.match(await fixture.locator('#shadow').locator('[data-error-translator] .text').innerText(),/【测试】Open shadow/);
  const sentTexts=requests.flatMap(r=>r.segments.map(s=>s.text)).join('\n');
  for(const forbidden of ['Do not translate this comment','const message','npm install','highlighted code','editor source','Never translate','The user is writing','Sensitive input','Hidden text','Invisible text','Do not translate this form']) assert.ok(!sentTexts.includes(forbidden),`Protected text leaked: ${forbidden}`);
  console.log('PASS: bilingual placement, inline link preservation, shadow DOM, same-origin iframe and protected content');
  await send('ET_RESTORE');assert.equal(await fixture.locator('[data-error-translator="translation"]').count(),0);
  await fixture.locator('#link').evaluate(link=>{window.originalLink=link;window.linkClicks=0;link.addEventListener('click',event=>{event.preventDefault();window.linkClicks++;});});
  await send('ET_START',{...settings,mode:'full'});await waitReady();
  assert.match(await fixture.locator('#simple').innerText(),/^【测试】/);
  assert.equal(await fixture.locator('#link').evaluate(link=>link===window.originalLink),true);
  await fixture.locator('#link').click();assert.equal(await fixture.evaluate(()=>window.linkClicks),1);
  assert.equal(await fixture.locator('#code').innerText(),'npm install');
  assert.equal(await fixture.locator('#spaced').evaluate(e=>e.childNodes[1].data),' ');
  await send('ET_RESTORE');assert.equal(await fixture.locator('#simple').innerText(),'Hello world. A better way to read.');assert.equal(await fixture.locator('#link').innerText(),'the original article');
  console.log('PASS: full-page translation keeps node identity and event handlers; restore recovers exact text');
  await send('ET_START',{...settings,mode:'hover'});await waitReady();
  assert.equal(await fixture.locator('#simple').innerText(),'Hello world. A better way to read.');
  await fixture.locator('#simple').hover();assert.match(await fixture.locator('#simple').innerText(),/【测试】Hello/);
  assert.equal(await fixture.locator('[data-error-translator="tooltip"]').count(),0);
  await fixture.locator('#code').hover();assert.match(await fixture.locator('#simple').innerText(),/【测试】Hello/);
  await new Promise(r=>setTimeout(r,900));assert.match(await fixture.locator('#simple').innerText(),/【测试】Hello/);
  // Re-entering within the grace period must cancel the old restoration timer.
  await fixture.locator('#simple').hover();await new Promise(r=>setTimeout(r,1250));
  assert.match(await fixture.locator('#simple').innerText(),/【测试】Hello/);
  await fixture.locator('#code').hover();
  await fixture.waitForFunction(()=>document.querySelector('#simple').innerText==='Hello world. A better way to read.',{},{timeout:3500});
  assert.equal(await fixture.locator('#code').innerText(),'npm install');
  await fixture.frameLocator('#frame').locator('#frame-text').hover();assert.match(await fixture.frameLocator('#frame').locator('#frame-text').innerText(),/【测试】Same origin/);
  await fixture.locator('#simple').hover();assert.match(await fixture.frameLocator('#frame').locator('#frame-text').innerText(),/【测试】Same origin/);
  await fixture.frameLocator('#frame').locator('#frame-text').evaluate(()=>new Promise(resolve=>setTimeout(resolve,2150)));
  assert.equal(await fixture.frameLocator('#frame').locator('#frame-text').innerText(),'Same origin iframe text.');
  await fixture.keyboard.press('Escape');assert.equal(await fixture.locator('#simple').innerText(),'Hello world. A better way to read.');
  await fixture.locator('#simple').hover();await fixture.locator('#code').hover();
  assert.match(await fixture.locator('#simple').innerText(),/【测试】Hello/);
  await send('ET_STOP');assert.equal(await fixture.locator('#simple').innerText(),'Hello world. A better way to read.');
  // Restoring a pending hover and starting full translation must discard the old timer.
  await send('ET_START',{...settings,mode:'hover'});await waitReady();
  await fixture.locator('#simple').hover();await fixture.locator('#code').hover();
  await send('ET_RESTORE');await send('ET_START',{...settings,mode:'full'});await waitReady();
  await new Promise(r=>setTimeout(r,2150));assert.match(await fixture.locator('#simple').innerText(),/【测试】Hello/);
  await send('ET_RESTORE');await send('ET_START',{...settings,mode:'hover'});await waitReady();
  await send('ET_STOP');await fixture.locator('#simple').hover();
  assert.equal(await fixture.locator('#simple').innerText(),'Hello world. A better way to read.');
  console.log('PASS: hover restores after 2 seconds, cancels restoration on re-entry, restores immediately on Escape, preserves code and frames');
  await send('ET_START',{...settings,mode:'bilingual',dynamic:true});await waitReady();
  await fixture.locator('#dynamic').evaluate(e=>{const p=document.createElement('p');p.id='added';p.textContent='New dynamically loaded text.';e.append(p);});
  await fixture.locator('#added [data-error-translator]').waitFor();
  await fixture.locator('#added').evaluate(e=>e.firstChild.data='Updated dynamic text.');
  await fixture.waitForFunction(()=>document.querySelector('#added [data-error-translator]')?.shadowRoot.textContent.includes('【测试】Updated dynamic text.'));
  assert.equal(await fixture.locator('#added [data-error-translator]').count(),1);
  console.log('PASS: mutation follow-up translates new and changed content without duplicate output');
  await send('ET_RESTORE');
  await fixture.locator('#dynamic').evaluate(e=>e.textContent='TRIGGER_DELAY pending text.');
  await send('ET_START',{...settings,mode:'full'});await send('ET_STOP');await new Promise(r=>setTimeout(r,1600));
  assert.equal((await status()).status,'paused');assert.equal(await fixture.locator('#dynamic').innerText(),'TRIGGER_DELAY pending text.');
  await fixture.locator('#dynamic').evaluate(e=>e.textContent='TRIGGER_FAILURE unavailable service.');
  await send('ET_START',{...settings,mode:'bilingual'});
  for(let i=0;i<100;i++) {if((await status()).status==='error') break;await new Promise(r=>setTimeout(r,100));}
  assert.equal((await status()).status,'error');assert.match((await status()).error,/401/);
  assert.equal(await fixture.locator('#dynamic').innerText(),'TRIGGER_FAILURE unavailable service.');
  await send('ET_RESTORE');console.log('PASS: cancellation ignores delayed results; supplier error preserves untranslated text');
  await fixture.locator('#dynamic').evaluate(e=>e.innerHTML='<p id="greeting">hello world</p>');
  await send('ET_START',{...settings,mode:'bilingual'});await waitReady();
  assert.equal(await fixture.locator('#greeting [data-error-translator] .text').innerText(),'你好世界');
  assert.equal(greetingDrafts,2);
  assert.ok(requests.some(r=>r.segments.length>1));
  await send('ET_START',{...settings,mode:'full'});await waitReady();assert.equal(await fixture.locator('#greeting').innerText(),'你好世界');
  await send('ET_START',{...settings,mode:'hover'});await waitReady();await fixture.locator('#greeting').hover();
  assert.equal(await fixture.locator('#greeting').innerText(),'你好世界');
  await fixture.locator('#pre').hover();assert.equal(await fixture.locator('#greeting').innerText(),'你好世界');
  await fixture.waitForFunction(()=>document.querySelector('#greeting').innerText==='hello world',{},{timeout:3500});
  await send('ET_RESTORE');
  await fixture.locator('#greeting').evaluate(e=>e.textContent='ALWAYS_EXPLAIN');
  await send('ET_START',{...settings,mode:'full'});
  for(let i=0;i<100;i++) {if((await status()).status==='error') break;await new Promise(r=>setTimeout(r,100));}
  assert.equal((await status()).status,'error');assert.match((await status()).error,/纯翻译检查/);
  assert.equal(await fixture.locator('#greeting').innerText(),'ALWAYS_EXPLAIN');
  await send('ET_RESTORE');
  console.log('PASS: explanatory output repaired to 你好世界 in all three modes; persistent monologue never reaches the page');
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  await worker.evaluate(tabId=>chrome.tabs.update(tabId,{active:true}),tabId);
  await popup.reload();await popup.waitForSelector('#provider option',{state:'attached'});
  await popup.setViewportSize({width:392,height:750});await popup.screenshot({path:'test-results/popup.png',fullPage:true});
  assert.equal(await popup.locator('#source').inputValue(),'auto');
  assert.equal(await popup.locator('#target').isVisible(),false);
  await popup.locator('#target-trigger').click();await popup.getByRole('searchbox').fill('English');
  await popup.getByRole('searchbox').press('Enter');assert.equal(await popup.locator('#target').inputValue(),'en');
  await choose(popup,'target','zh-CN');
  assert.equal(await popup.locator('#context').isEnabled(),true);
  if(protocol==='responses') assert.match(await popup.locator('#provider-meta').innerText(),/Responses/);
  await popup.getByRole('radio',{name:/悬停翻译/}).click();
  assert.equal(await popup.getByRole('radio',{name:/悬停翻译/}).getAttribute('aria-checked'),'true');
  await fixture.locator('#dynamic').evaluate(e=>e.textContent='Popup starts translation.');
  await popup.getByRole('button',{name:'翻译当前网页',exact:true}).click();await waitReady();
  assert.equal((await status()).mode,'hover');
  await fixture.locator('#dynamic').hover();assert.match(await fixture.locator('#dynamic').innerText(),/【测试】Popup starts/);
  await popup.getByRole('button',{name:/恢复原文/}).click();assert.equal((await status()).status,'idle');
  await options.getByRole('button',{name:'阅读与精度'}).click();await options.locator('#pref-glossary').fill('machine learning = 机器学习');
  await options.locator('#pref-batchSize').fill('19');await options.locator('#pref-concurrency').fill('6');
  await options.locator('#pref-requestTimeout').fill('173');await options.locator('#pref-requestInterval').fill('425');
  await options.getByRole('button',{name:'保存阅读偏好'}).click();
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.glossary),'machine learning = 机器学习');
  assert.deepEqual(await worker.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');return [settings.batchSize,settings.requestInterval,settings.concurrency,settings.requestTimeout];}),[19,425,6,173]);
  // An already open popup must preserve request preferences saved elsewhere.
  await popup.locator('#context').uncheck();
  await popup.waitForFunction(async()=>!(await chrome.storage.local.get('settings')).settings.context);
  assert.deepEqual(await worker.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');return [settings.batchSize,settings.requestInterval,settings.concurrency,settings.requestTimeout];}),[19,425,6,173]);
  await options.getByRole('button',{name:'填入建议值 ↗'}).click();
  assert.deepEqual(await options.evaluate(()=>['batchSize','requestInterval','concurrency','requestTimeout'].map(key=>Number(document.getElementById(`pref-${key}`).value))),[16,350,5,120]);
  await options.getByRole('button',{name:'保存阅读偏好'}).click();
  await options.screenshot({path:'test-results/settings-requests.png',fullPage:true});

  // Exercise both the content worker pool and the actual background network pool.
  const parallelPage=await context.newPage();await parallelPage.goto(`${base}/fixture`);
  await parallelPage.evaluate(()=>{document.body.replaceChildren();for(let i=0;i<80;i++){const p=document.createElement('p');p.id=`parallel-${i}`;p.textContent=`PARALLEL_SEGMENT_${i}`;document.body.append(p);}});
  const parallelTab=await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).filter(t=>t.url===url).at(-1);await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/content/dom.js','src/content/controller.js']});return tab.id;},`${base}/fixture`);
  await worker.evaluate(({tabId,settings})=>chrome.tabs.sendMessage(tabId,{type:'ET_START',settings}),{tabId:parallelTab,settings:{...settings,mode:'full',batchSize:16,concurrency:5,requestInterval:0}});
  await waitReady(parallelTab);
  assert.equal((await status(parallelTab)).status,'ready');
  assert.equal(maxParallel,5);assert.notDeepEqual(parallelFinished,[0,16,32,48,64]);
  const parallelBatches=requests.filter(r=>r.segments.every(s=>s.text.startsWith('PARALLEL_SEGMENT_')));
  assert.equal(parallelBatches.length,5);assert.ok(parallelBatches.every(r=>r.segments.length===16));
  for(let i=0;i<80;i++) assert.equal(await parallelPage.locator(`#parallel-${i}`).innerText(),`【测试】PARALLEL_SEGMENT_${i}`);
  assert.equal((await status(parallelTab)).done,80);
  await worker.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'ET_RESTORE'}),parallelTab);
  await parallelPage.evaluate(()=>{for(let i=0;i<80;i++) document.getElementById(`parallel-${i}`).textContent=`PARALLEL_SEGMENT_STOP_${i}`;});
  await worker.evaluate(({tabId,settings})=>chrome.tabs.sendMessage(tabId,{type:'ET_START',settings}),{tabId:parallelTab,settings:{...settings,mode:'full',batchSize:16,concurrency:5,requestInterval:0}});
  const cancelDeadline=Date.now()+3000;
  while(activeParallel<5 && Date.now()<cancelDeadline) await new Promise(r=>setTimeout(r,20));
  assert.equal(activeParallel,5);
  await worker.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'ET_STOP'}),parallelTab);
  await new Promise(r=>setTimeout(r,1400));
  assert.equal((await status(parallelTab)).status,'paused');
  for(let i=0;i<80;i++) assert.equal(await parallelPage.locator(`#parallel-${i}`).innerText(),`PARALLEL_SEGMENT_STOP_${i}`);
  await parallelPage.close();
  console.log('PASS: custom request settings and recommendations; 5 simultaneous requests × 16 segments, out-of-order results, progress and cancellation');
  await options.getByRole('button',{name:/翻译供应商/}).click();await options.getByRole('button',{name:'编辑',exact:true}).click();
  await options.setViewportSize({width:1440,height:1050});await options.screenshot({path:'test-results/settings.png',fullPage:true});
  await options.setViewportSize({width:560,height:900});await options.screenshot({path:'test-results/settings-mobile.png',fullPage:true});
  assert.equal(await options.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(protocol==='responses') {
    // A real MV3 fetch longer than both the previous 25s timeout and Chrome's
    // normal 30s idle window must complete using the saved extended timeout.
    await options.setViewportSize({width:1440,height:1050});
    await options.locator('#model').fill('slow-translator');await options.locator('#model').press('Escape');
    await options.getByRole('button',{name:'测试连接',exact:true}).click();
    await options.waitForFunction(()=>document.querySelector('#editor-note').textContent.includes('连接成功') || document.querySelector('#editor-note').classList.contains('error'),{},{timeout:45000});
    assert.match(await options.locator('#editor-note').textContent(),/连接成功/);
    console.log('PASS: saved 120s timeout survives a 32s upstream response with finite service worker activity');
    await options.getByRole('button',{name:'关于艾拉'}).click();
    const downloadPromise=options.waitForEvent('download');
    await options.getByRole('button',{name:'导出配置',exact:true}).click();
    const download=await downloadPromise,exportPath=resolve('test-results/responses-config.json');await download.saveAs(exportPath);
    const exported=JSON.parse(await readFile(exportPath,'utf8'));assert.equal(exported.providers[0].type,'responses');assert.equal(exported.providers[0].apiKey,undefined);
    await options.locator('#import-file').setInputFiles(exportPath);
    await options.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已导入配置'));
    const imported=await worker.evaluate(()=>chrome.storage.local.get('providers'));
    assert.equal(imported.providers.length,2);assert.equal(imported.providers[1].type,'responses');assert.equal(imported.providers[1].apiKey,'');
    for(const {url,body} of protocolRequests) {assert.equal(url,'/v1/responses');assert.equal(body.store,false);assert.equal(body.messages,undefined);}
    console.log('PASS: Responses export/import and all requests use the selected protocol without response storage');
  } else for(const {url} of protocolRequests) assert.equal(url,'/v1/chat/completions');
  assert.deepEqual(errors,[]);console.log('PASS: popup interactions, saved precision preferences, responsive settings and no page errors');
  console.log(`All browser checks passed: ${protocol==='responses'?'Responses':'Chat Completions'} with a real MV3 extension and a local test supplier.`);
} finally {
  await context.close();await new Promise(r=>server.close(r));
  // Delete only this test's verified directory under the OS temp directory.
  if(profile.startsWith(resolve(tmpdir())+'\\') || profile.startsWith(resolve(tmpdir())+'/')) await rm(profile,{recursive:true,force:true});
}
