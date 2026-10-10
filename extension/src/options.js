import {PRESETS,LANGUAGES,createProvider,getConfig,saveSettings,providerOrigin,validateProvider,DEFAULT_SETTINGS,isAIProvider,PROVIDER_TYPES,normalizeSettings} from './config.js';
import {enhanceSelects,refreshSelects,enhanceModelInput} from './ui-controls.js';
const $=id=>document.getElementById(id);
let config,editing=null,toastTimer;
function toast(text,error=false) {
  $('toast').textContent=text;$('toast').hidden=false;$('toast').classList.toggle('error',error);
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);
}
function note(text,type='') {$('editor-note').textContent=text;$('editor-note').className=`editor-note ${type}`;}
function mark(provider) {const span=document.createElement('span');span.className='provider-mark';span.textContent=provider.mark || '+';span.style.color=provider.color || '#cc654c';span.style.background=`${provider.color || '#cc654c'}14`;return span;}
function button(text,action,className='text-button') {const element=document.createElement('button');element.type='button';element.className=className;element.textContent=text;element.addEventListener('click',action);return element;}
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(panel=>panel.hidden=panel.id!==`panel-${name}`);
  document.querySelectorAll('[data-panel]').forEach(nav=>nav.classList.toggle('active',nav.dataset.panel===name));
  $('breadcrumb-current').textContent={providers:'翻译供应商',preferences:'阅读与精度',about:'关于艾拉'}[name];
  history.replaceState(null,'',`#${name}`);
}
function renderSaved() {
  $('saved-providers').replaceChildren();
  $('empty-state').hidden=Boolean(config.providers.length);
  $('connected-count').textContent=config.providers.length;$('provider-count').textContent=config.providers.length;
  for(const provider of config.providers) {
    const card=document.createElement('div');card.className='saved-provider';card.append(mark(provider));
    const info=document.createElement('div');info.className='provider-info';
    const title=document.createElement('strong');title.textContent=provider.name;
    const summary=document.createElement('p');summary.textContent=`${isAIProvider(provider)?`${provider.model || '未选择模型'} · ${provider.type==='responses'?'Responses':'Chat Completions'}`:'标准翻译 API'} · ${provider.apiKey?'已保存密钥':'待填写密钥'} · ${new URL(provider.apiUrl).hostname}`;
    info.append(title,summary);card.append(info);
    const actions=document.createElement('div');actions.className='provider-actions';
    if(config.settings.providerId===provider.id) {const badge=document.createElement('span');badge.className='default-badge';badge.textContent='当前使用';actions.append(badge);}
    else actions.append(button('设为当前',async()=>{await saveSettings({providerId:provider.id});config.settings.providerId=provider.id;renderSaved();toast(`已切换到 ${provider.name}`);}));
    actions.append(button('编辑',()=>openEditor(provider)),button('删除',()=>deleteProvider(provider)));
    card.append(actions);$('saved-providers').append(card);
  }
}
async function deleteProvider(provider) {
  // A native confirmation protects accidental loss of a locally stored key.
  if(!confirm(`删除「${provider.name}」及其本地密钥？`)) return;
  config.providers=config.providers.filter(p=>p.id!==provider.id);
  const patch={providers:config.providers};
  if(config.settings.providerId===provider.id) {config.settings.providerId=config.providers[0]?.id || '';patch.settings=config.settings;}
  await chrome.storage.local.set(patch);
  if(editing?.id===provider.id) closeEditor();renderSaved();toast('供应商已删除。');
}
function fillModels(models) {$('model-list').replaceChildren(...models.map(id=>{const option=document.createElement('option');option.value=id;return option;}));}
function typeFields() {
  const type=$('provider-type').value;
  const ai=isAIProvider({type});
  $('model-field').hidden=!ai;$('app-id-field').hidden=type!=='baidu';
  $('model').required=ai;$('app-id').required=type==='baidu';
  $('url-hint').textContent=ai?`填写基础地址（如 https://api.example/v1），或完整的 /${type==='responses'?'responses':'chat/completions'} 地址。`:'填写此翻译服务的完整翻译接口地址。';
  const notes={ai:'模型获取和连接测试不会自动保存配置。',responses:'使用 Responses 协议，请确认上游支持 /responses。支持模型获取、上下文与纯译文复核；请求默认不存储响应。',google:'需要 Google Cloud Translation Basic API Key，并在 Google Cloud 项目中启用 API 和结算。',deepl:'Free 与 Pro 密钥对应不同地址，请使用与你的 API 计划匹配的预设。',baidu:'百度官方接口必须同时提供 APP ID 与密钥。已内置 MD5 签名及每秒最多一次请求的调度。'};
  note(notes[type]);
  refreshSelects();
}
function openEditor(provider) {
  editing={...provider};showPanel('providers');$('provider-editor').hidden=false;
  $('editor-title').textContent=config.providers.some(p=>p.id===provider.id)?`编辑 ${provider.name}`:`连接 ${provider.name}`;
  $('provider-name').value=provider.name;$('provider-type').value=provider.type;
  $('api-url').value=provider.apiUrl;$('api-key').value=provider.apiKey || '';$('app-id').value=provider.appId || '';$('model').value=provider.model || '';
  $('api-key').type='password';$('toggle-key').textContent='显示';
  $('provider-docs').hidden=!provider.docs;$('provider-docs').href=provider.docs || '#';
  fillModels(provider.models || []);typeFields();
  document.querySelectorAll('.preset-card').forEach(card=>card.classList.toggle('selected',card.dataset.preset===provider.presetId));
  $('provider-editor').scrollIntoView({behavior:'instant',block:'start'});
  setTimeout(()=>(provider.apiUrl?$('api-key'):$('api-url')).focus({preventScroll:true}),200);
}
function closeEditor() {editing=null;$('provider-editor').hidden=true;document.querySelectorAll('.preset-card').forEach(card=>card.classList.remove('selected'));}
function readProvider() {
  if(!editing) throw new Error('请先选择一个供应商。');
  return {...editing,name:$('provider-name').value.trim(),type:$('provider-type').value,apiUrl:$('api-url').value.trim(),apiKey:$('api-key').value.trim(),appId:$('app-id').value.trim(),model:$('model').value.trim(),updatedAt:Date.now()};
}
function requestPermission(provider) {return chrome.permissions.request({origins:[providerOrigin(provider)]});}
function renderPresets() {
  for(const preset of PRESETS.filter(p=>p.id!=='custom')) {
    const card=document.createElement('button');card.type='button';card.className='preset-card';card.dataset.preset=preset.id;
    const top=document.createElement('div');top.className='preset-top';top.append(mark(preset));
    const title=document.createElement('strong');title.textContent=preset.name;
    const kind=document.createElement('span');kind.textContent=isAIProvider(preset)?'AI':'翻译';top.append(title,kind);
    const description=document.createElement('p');description.textContent=preset.description;
    const connect=document.createElement('span');connect.className='connect-label';connect.textContent='添加连接 ↗';
    card.append(top,description,connect);card.addEventListener('click',()=>openEditor(createProvider(preset.id)));$('presets').append(card);
  }
}
async function editorAction(action) {
  try {
    const provider=readProvider();
    if(action==='models') {providerOrigin(provider);if(!provider.apiKey && !['localhost','127.0.0.1'].includes(new URL(provider.apiUrl).hostname)) throw new Error('请先填写 API Key。');}
    else validateProvider(provider);
    const granted=await requestPermission(provider);
    if(!granted) throw new Error('需要授权访问这个 API 地址才能使用服务。');
    if(action==='save') {
      const index=config.providers.findIndex(p=>p.id===provider.id);
      if(index<0) config.providers.push(provider);else config.providers[index]=provider;
      await chrome.storage.local.set({providers:config.providers});
      if(!config.settings.providerId) {config.settings.providerId=provider.id;await saveSettings({providerId:provider.id});}
      renderSaved();closeEditor();toast('连接已保存，点击浏览器扩展图标即可开始翻译。');return;
    }
    const trigger=$(action==='models'?'fetch-models':'test-provider');trigger.disabled=true;note(action==='models'?'正在从上游获取模型…':'正在测试连接，翻译「Hello, world!」…');
    try {
      const result=await chrome.runtime.sendMessage({type:action==='models'?'ET_MODELS':'ET_TEST',provider});
      if(!result?.ok) throw new Error(result?.error || '连接失败。');
      if(action==='models') {
        editing.models=result.models;fillModels(result.models);
        if(!$('model').value || !result.models.includes($('model').value)) $('model').value=result.models[0];
        note(`已获取 ${result.models.length} 个模型，在模型输入框中选择或搜索。`,'success');
      } else note(`连接成功${result.protocol==='responses' && provider.type==='ai'?' · 已自动兼容切换至 Responses':''} · 测试译文：${result.text}`,'success');
    } finally {trigger.disabled=false;}
  } catch(error) {note(error.message,'error');}
}
function fillPreferences() {
  for(const id of ['source','target']) {
    const select=$(`pref-${id}`);select.replaceChildren();
    if(id==='source') select.add(new Option('自动检测','auto'));
    LANGUAGES.forEach(([value,label])=>select.add(new Option(label,value)));
  }
  for(const [key,value] of Object.entries(config.settings)) {
    const element=$(`pref-${key}`);if(!element) continue;
    if(element.type==='checkbox') element.checked=value;else element.value=value;
  }
  refreshSelects();
}
$('provider-form').addEventListener('submit',event=>{event.preventDefault();editorAction('save');});
$('provider-type').addEventListener('change',typeFields);
$('fetch-models').addEventListener('click',()=>editorAction('models'));
$('test-provider').addEventListener('click',()=>editorAction('test'));
$('add-custom').addEventListener('click',()=>openEditor(createProvider('custom')));
$('close-editor').addEventListener('click',closeEditor);
$('toggle-key').addEventListener('click',()=>{const reveal=$('api-key').type==='password';$('api-key').type=reveal?'text':'password';$('toggle-key').textContent=reveal?'隐藏':'显示';});
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>showPanel(button.dataset.panel)));
$('preferences-form').addEventListener('submit',async event=>{
  event.preventDefault();const patch={};
  for(const key of Object.keys(DEFAULT_SETTINGS)) {const element=$(`pref-${key}`);if(element) patch[key]=element.type==='checkbox'?element.checked:typeof DEFAULT_SETTINGS[key]==='number'?Number(element.value):element.value;}
  await saveSettings(patch);config.settings=normalizeSettings({...config.settings,...patch});fillPreferences();toast('阅读偏好已保存，下次翻译时生效。');
});
$('request-recommended').addEventListener('click',()=>{
  for(const key of ['concurrency','batchSize','requestTimeout','requestInterval']) $(`pref-${key}`).value=DEFAULT_SETTINGS[key];
  toast('已填入建议值：5 并发、16 段、120 秒、350 毫秒；点击保存后生效。');
});
$('clear-cache').addEventListener('click',async()=>{const result=await chrome.runtime.sendMessage({type:'ET_CLEAR_CACHE'});toast(result.ok?'翻译缓存已清空。':result.error,!result.ok);});
$('export-config').addEventListener('click',()=>{
  const data={version:1,settings:config.settings,providers:config.providers.map(({apiKey,appId,...provider})=>provider)};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download='error-translator-config.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('配置已导出，不包含密钥或 APP ID。');
});
$('import-config').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async event=>{
  try {
    const file=event.target.files[0];if(!file) return;
    if(file.size>100000) throw new Error('配置文件过大。');
    const data=JSON.parse(await file.text());
    if(data.version!==1 || !Array.isArray(data.providers) || data.providers.length>30) throw new Error('配置文件格式不正确。');
    const remap=new Map();
    const imported=data.providers.map(item=>{
      if(!PROVIDER_TYPES.includes(item.type) || typeof item.name!=='string' || !item.name.trim() || typeof item.apiUrl!=='string') throw new Error('供应商配置格式不正确。');
      providerOrigin(item);
      const preset=PRESETS.find(p=>p.id===item.presetId && p.type===item.type) || PRESETS.at(-1);
      const provider={...createProvider(preset.id),name:item.name.slice(0,80),type:item.type,apiUrl:item.apiUrl,model:typeof item.model==='string'?item.model.slice(0,200):'',models:Array.isArray(item.models)?item.models.filter(m=>typeof m==='string').slice(0,1000):[],apiKey:'',appId:'',updatedAt:Date.now()};
      remap.set(item.id,provider.id);return provider;
    });
    const patch={};
    for(const [key,defaultValue] of Object.entries(DEFAULT_SETTINGS)) if(typeof data.settings?.[key]===typeof defaultValue) patch[key]=data.settings[key];
    if(!LANGUAGES.some(([code])=>code===patch.target)) delete patch.target;
    if(patch.source!=='auto' && !LANGUAGES.some(([code])=>code===patch.source)) delete patch.source;
    if(!['full','bilingual','hover'].includes(patch.mode)) delete patch.mode;
    if(!['natural','literal','formal'].includes(patch.style)) delete patch.style;
    patch.glossary=(patch.glossary || '').slice(0,6000);
    patch.providerId=remap.get(data.settings?.providerId) || config.settings.providerId || imported[0]?.id || '';
    config.providers.push(...imported);await chrome.storage.local.set({providers:config.providers});await saveSettings(patch);
    config.settings=normalizeSettings({...config.settings,...patch});renderSaved();fillPreferences();toast('已导入配置，请编辑供应商并填写凭据。');
  } catch(error) {toast(error.message || '导入失败。',true);} finally {event.target.value='';}
});
async function initialize() {
  config=await getConfig();renderPresets();renderSaved();fillPreferences();
  enhanceSelects();enhanceModelInput($('model'),$('model-list'));
  showPanel(['providers','preferences','about'].includes(location.hash.slice(1))?location.hash.slice(1):'providers');
}
initialize().catch(error=>toast(error.message,true));
