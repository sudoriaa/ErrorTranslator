import {getConfig, providerOrigin, validateProvider, LANGUAGES, isAIProvider,normalizeSettings} from './config.js';
import {translate, fetchModels,effectiveProtocol} from './api.js';
import {TRANSLATION_POLICY_VERSION} from './translation-agent.js';

const cache=new Map();
const jobs=new Map();
const locks=new Map();
const cancelEpoch=new Map();
const allowedLanguages=new Set(LANGUAGES.map(([id])=>id));
let activeMessages=0,activityTimer=null;
async function handleWithActivity(message,sender) {
  if(!['ET_TRANSLATE','ET_MODELS','ET_TEST'].includes(message.type)) return handle(message,sender);
  // Keep this finite user operation alive while waiting for a slow AI response.
  // The timer ends once all network messages have completed or been cancelled.
  if(activeMessages++===0) activityTimer=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
  try {return await handle(message,sender);}
  finally {if(--activeMessages===0){clearInterval(activityTimer);activityTimer=null;}}
}
chrome.runtime.onInstalled.addListener(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const config=await getConfig();
  await chrome.storage.local.set(config);
});

async function authorized(provider) {
  const origin=providerOrigin(provider);
  if(!await chrome.permissions.contains({origins:[origin]})) throw new Error('请在供应商设置中授权访问 API 地址。');
}

async function withBaiduRateLimit(provider, task) {
  if(provider.type!=='baidu') return task();
  const previous=locks.get(provider.id) || Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    try {return await task();} finally {await new Promise(r=>setTimeout(r,1100));}
  });
  locks.set(provider.id,next);
  try {return await next;} finally {if(locks.get(provider.id)===next) locks.delete(provider.id);}
}

async function handle(message,sender) {
  const trusted=sender.url?.startsWith(chrome.runtime.getURL(''));
  if(message.type==='ET_CANCEL') {
    if(!sender.tab && !trusted) throw new Error('无效请求。');
    const tabId=sender.tab?.id ?? message.tabId;
    cancelEpoch.set(tabId,(cancelEpoch.get(tabId) || 0)+1);
    for(const [key,controller] of jobs) if(key.startsWith(`${tabId}:`)){controller.abort();jobs.delete(key);}
    return {};
  }
  if(message.type==='ET_MODELS' || message.type==='ET_TEST') {
    if(!trusted) throw new Error('仅设置页可操作供应商。');
    const provider=message.provider;
    await authorized(provider);
    const {settings}=await getConfig();
    if(message.type==='ET_MODELS') return {models:await fetchModels(provider,fetch,settings)};
    validateProvider(provider);
    const result=await withBaiduRateLimit(provider,()=>translate(provider,[{id:'test',text:'Hello, world!'}],{...settings,context:false},{}));
    return {text:result[0].text,protocol:effectiveProtocol(provider)};
  }
  if(message.type==='ET_CLEAR_CACHE') {
    if(!trusted) throw new Error('无效请求。');
    cache.clear(); return {};
  }
  if(message.type!=='ET_TRANSLATE' || !sender.tab) throw new Error('无效翻译请求。');
  const epoch=cancelEpoch.get(sender.tab.id) || 0;
  const {settings:saved,providers}=await getConfig();
  // All tabs share the saved network limit, including sessions started earlier.
  const settings=normalizeSettings({...saved,...message.settings,concurrency:saved.concurrency});
  if(!allowedLanguages.has(settings.target) || !(settings.source==='auto' || allowedLanguages.has(settings.source))) throw new Error('无效的翻译语言。');
  const provider=providers.find(p=>p.id===settings.providerId);
  if(!provider) throw new Error('请先添加并选择一个翻译供应商。');
  await authorized(provider);
  const segments=message.segments;
  if(!Array.isArray(segments) || !segments.length || segments.length>64 || new Set(segments.map(s=>s?.id)).size!==segments.length || segments.some(s=>typeof s.id!=='string' || typeof s.text!=='string' || s.text.length>12000 || typeof (s.context ?? '')!=='string' || (s.context?.length || 0)>3000) || segments.reduce((n,s)=>n+s.text.length,0)>14000) throw new Error('翻译请求过大或格式不正确。');
  const jobKey=`${sender.tab.id}:${message.jobId}`;
  if(epoch!==(cancelEpoch.get(sender.tab.id) || 0)) throw new Error('翻译已停止。');
  const controller=new AbortController(); jobs.set(jobKey,controller);
  const context={title:String(message.context?.title || '').slice(0,500)};
  const keys=segments.map(s=>JSON.stringify([TRANSLATION_POLICY_VERSION,provider.id,provider.updatedAt,provider.type,provider.apiUrl,provider.model,settings.source,settings.target,isAIProvider(provider)?[settings.context,settings.terminology,settings.preserveNames,settings.proofread,settings.style,settings.glossary,settings.context?s.context:'',settings.context?context.title:'']:null,s.text]));
  const missing=segments.filter((s,i)=>!cache.has(keys[i]));
  try {
    if(missing.length) {
      const output=await withBaiduRateLimit(provider,()=>translate(provider,missing,settings,context,controller.signal));
      output.forEach(s=>{
        const index=segments.findIndex(input=>input.id===s.id);
        cache.set(keys[index],s.text);
      });
      while(cache.size>800) cache.delete(cache.keys().next().value);
    }
    if(controller.signal.aborted) throw new Error('翻译已停止。');
    return {translations:segments.map((s,i)=>({id:s.id,text:cache.get(keys[i])})),protocol:effectiveProtocol(provider)};
  } finally {jobs.delete(jobKey);}
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message?.type?.startsWith('ET_')) return;
  handleWithActivity(message,sender).then(data=>respond({ok:true,...data})).catch(error=>respond({ok:false,error:error.message || '翻译失败。'}));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{
  cancelEpoch.delete(tabId);
  for(const [key,controller] of jobs) if(key.startsWith(`${tabId}:`)){controller.abort();jobs.delete(key);}
});
