import {LANGUAGES,getConfig,saveSettings,providerOrigin,isAIProvider} from './config.js';
import {enhanceSelects,refreshSelects} from './ui-controls.js';
const $=id=>document.getElementById(id);
let config,tab,busy=false,polling;
const precisionIds=['context','terminology','preserveNames','proofread'];
function message(text,error=false) {$('message').textContent=text;$('message').classList.toggle('error',error);}
function provider() {return config.providers.find(p=>p.id===$('provider').value);}
function renderProvider() {
  const current=provider(),ai=isAIProvider(current);
  $('provider-mark').textContent=current?.mark || '+';
  $('provider-mark').style.color=current?.color || '#cc654c';
  $('provider-mark').style.background=current?.color?`${current.color}14`:'#f9eee8';
  $('provider-kind').textContent=ai?'AI':'翻译';
  $('provider-meta').textContent=current?(ai?`${current.model} · ${current.type==='responses'?'Responses':'Chat Completions'}`:current.description || current.name):'连接你信任的 AI 或翻译服务';
  precisionIds.forEach(id=>$(id).disabled=!ai);
  $('precision-note').textContent=ai?'默认分组合并请求；译文自检开启时增加独立复核。':'精度增强仅适用于 AI，当前使用供应商标准翻译。';
  $('translate').disabled=!current || busy;
  refreshSelects();
}
function renderMode(mode) {
  document.querySelectorAll('[data-mode]').forEach(button=>{
    const selected=button.dataset.mode===mode;button.classList.toggle('selected',selected);button.setAttribute('aria-checked',String(selected));
  });
}
function settings() {
  const patch={source:$('source').value,target:$('target').value,providerId:$('provider').value,
    mode:document.querySelector('[data-mode].selected').dataset.mode};
  precisionIds.forEach(id=>patch[id]=$(id).checked);
  return {...config.settings,...patch,providerType:provider()?.type};
}
async function save() {
  const next=settings();
  const patch=Object.fromEntries(['source','target','providerId','mode',...precisionIds].map(key=>[key,next[key]]));
  await saveSettings(patch);
  config.settings=(await getConfig()).settings;
}
async function ensureContent() {
  if(!tab?.id || !/^(https?:|file:)/.test(tab.url || '')) throw new Error('当前页面不支持翻译，请打开普通网页。');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/content/dom.js','src/content/controller.js']});
}
async function refreshStatus() {
  try {
    const state=await chrome.tabs.sendMessage(tab.id,{type:'ET_STATUS'});
    if(!state) return;
    const running=state.status==='running';
    $('stop').hidden=!running;$('protected-note').hidden=running;
    $('progress-track').hidden=!state.total || state.status==='idle';
    $('progress-bar').style.width=`${state.total?Math.round(state.done/state.total*100):0}%`;
    if(running) message(`正在翻译 · ${state.done} / ${state.total} 段`);
    else if(state.status==='ready') message(state.error || `已完成 ${state.total} 段翻译${state.mode==='hover'?' · 悬停原位显示译文，移开 2 秒后恢复':''}${state.protocol==='responses' && provider()?.type==='ai'?' · 已兼容 Responses':''}`);
    else if(state.status==='error') message(state.error,true);
    else if(state.status==='paused') message(`已停止 · 完成 ${state.done} / ${state.total} 段，可重新翻译或恢复原文`);
    else message('');
    $('translate').querySelector('span').textContent=running?'切换设置并重新翻译':'翻译当前网页';
  } catch {}
}
async function initialize() {
  config=await getConfig();
  for(const [id,label] of LANGUAGES) {
    $('source').add(new Option(label,id));$('target').add(new Option(label,id));
  }
  $('source').add(new Option('自动检测','auto'),0);
  $('source').value=config.settings.source;$('target').value=config.settings.target;
  precisionIds.forEach(id=>$(id).checked=config.settings[id]);
  renderMode(config.settings.mode);
  for(const current of config.providers) $('provider').add(new Option(current.name,current.id));
  if(config.providers.length) {
    $('provider').options[0].remove();
    $('provider').value=config.providers.some(p=>p.id===config.settings.providerId)?config.settings.providerId:config.providers[0].id;
  }
  renderProvider();
  enhanceSelects();
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  try {const url=new URL(tab.url);$('page-host').textContent=url.protocol==='file:'?'本地网页':/^https?:$/.test(url.protocol)?url.hostname:'此页面不支持翻译';} catch {$('page-host').textContent='当前页面';}
  await refreshStatus();polling=setInterval(refreshStatus,600);
}
['open-settings','manage-providers'].forEach(id=>$(id).addEventListener('click',()=>chrome.runtime.openOptionsPage()));
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',async()=>{renderMode(button.dataset.mode);await save();}));
['source','target','provider',...precisionIds].forEach(id=>$(id).addEventListener('change',async()=>{renderProvider();await save();}));
$('swap').addEventListener('click',async()=>{
  if($('source').value==='auto') {message('请先选择具体源语言，再交换语言。');return;}
  const previous=$('source').value;$('source').value=$('target').value;$('target').value=previous;refreshSelects();await save();
});
$('translate').addEventListener('click',async()=>{
  // Permission must be requested directly inside the click gesture.
  const current=provider();if(!current) return;
  busy=true;renderProvider();message('正在准备翻译…');
  try {
    const granted=await chrome.permissions.request({origins:[providerOrigin(current)]});
    if(!granted) throw new Error('需要访问所选供应商的 API 地址才能翻译。');
    await save();await ensureContent();
    await chrome.tabs.sendMessage(tab.id,{type:'ET_START',settings:settings()});
    await refreshStatus();
  } catch(error) {message(error.message || '无法翻译本页，请刷新后重试。',true);}
  finally {busy=false;renderProvider();}
});
for(const [id,type] of [['restore','ET_RESTORE'],['stop','ET_STOP']]) {
  $(id).addEventListener('click',async()=>{
    try {await chrome.tabs.sendMessage(tab.id,{type});await refreshStatus();if(type==='ET_RESTORE') message('已恢复网页原文。');}
    catch {message('当前页面还没有开始翻译。');}
  });
}
window.addEventListener('unload',()=>clearInterval(polling));
initialize().catch(error=>message(error.message,true));
