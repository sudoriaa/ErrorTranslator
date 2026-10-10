export const LANGUAGES = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'],
  ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
  ['pt', 'Português'], ['it', 'Italiano'], ['ru', 'Русский'], ['ar', 'العربية'],
  ['hi', 'हिन्दी'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'],
  ['nl', 'Nederlands'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['uk', 'Українська']
];

export const PRESETS = [
  {id:'deepseek', name:'DeepSeek', type:'ai', apiUrl:'https://api.deepseek.com', model:'deepseek-flash', models:['deepseek-flash','deepseek-v4-pro'], mark:'D', color:'#4263eb', description:'擅长理解上下文与复杂表达', docs:'https://api-docs.deepseek.com/api/create-chat-completion'},
  {id:'qwen', name:'通义千问', type:'ai', apiUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus', models:['qwen-plus','qwen-flash','qwen-max'], mark:'Q', color:'#7856d8', description:'阿里云百炼 · 北京地域 API Key', docs:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'},
  {id:'google', name:'Google 翻译', type:'google', apiUrl:'https://translation.googleapis.com/language/translate/v2', model:'nmt', mark:'G', color:'#4285f4', description:'Cloud Translation Basic · 广泛的语言覆盖', docs:'https://cloud.google.com/translate/docs/reference/rest/v2/translate'},
  {id:'deepl-free', name:'DeepL Free', type:'deepl', apiUrl:'https://api-free.deepl.com/v2/translate', model:'', mark:'L', color:'#163c56', description:'DeepL API Free 专用密钥', docs:'https://developers.deepl.com/api-reference/translate'},
  {id:'deepl-pro', name:'DeepL Pro', type:'deepl', apiUrl:'https://api.deepl.com/v2/translate', model:'', mark:'L', color:'#163c56', description:'DeepL API Pro 专用密钥', docs:'https://developers.deepl.com/api-reference/translate'},
  {id:'baidu', name:'百度翻译', type:'baidu', apiUrl:'https://fanyi-api.baidu.com/api/trans/vip/translate', model:'', mark:'百', color:'#315bda', description:'通用文本翻译 · 需要 APP ID 和密钥', docs:'https://fanyi-api.baidu.com/doc/23'},
  {id:'custom', name:'自定义 AI', type:'ai', apiUrl:'', model:'', models:[], mark:'+', color:'#d7654c', description:'兼容 Chat Completions / Responses 的服务或本地模型', docs:''}
];

export const PROVIDER_TYPES = ['ai','responses','google','deepl','baidu'];
export function isAIProvider(provider) {return provider?.type==='ai' || provider?.type==='responses';}

export const DEFAULT_SETTINGS = {
  source:'auto', target:'zh-CN', mode:'bilingual', providerId:'',
  context:true, terminology:true, preserveNames:true, proofread:false,
  dynamic:true, glossary:'', style:'natural',batchSize:16,requestInterval:350,concurrency:5,requestTimeout:120
};

export const REQUEST_LIMITS={batchSize:[1,64],requestInterval:[0,10000],concurrency:[1,20],requestTimeout:[10,600]};

export function normalizeSettings(settings) {
  const normalized={...DEFAULT_SETTINGS,...settings};
  for(const [key,[min,max]] of Object.entries(REQUEST_LIMITS)) {
    const value=Number(normalized[key]);
    normalized[key]=Number.isFinite(value)?Math.min(max,Math.max(min,Math.round(value))):DEFAULT_SETTINGS[key];
  }
  return normalized;
}

export async function getConfig() {
  const data = await chrome.storage.local.get(['settings','providers']);
  return {settings:normalizeSettings(data.settings), providers:data.providers || []};
}

export async function saveSettings(patch) {
  const {settings} = await getConfig();
  await chrome.storage.local.set({settings:normalizeSettings({...settings,...patch})});
}

export function createProvider(presetId) {
  const preset = PRESETS.find(p=>p.id===presetId) || PRESETS.at(-1);
  return {...preset, id:crypto.randomUUID(), presetId:preset.id, apiKey:'', appId:''};
}

export function providerOrigin(provider) {
  const url = new URL(provider.apiUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含用户名、密码、查询参数或片段。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('请使用 HTTPS 地址；本地模型可使用 http://localhost 或 127.0.0.1。');
  return `${url.origin}/*`;
}

export function validateProvider(provider) {
  if (!PROVIDER_TYPES.includes(provider.type)) throw new Error('不支持的供应商接口类型。');
  if (!provider.name.trim()) throw new Error('请填写供应商名称。');
  providerOrigin(provider);
  if (!provider.apiKey.trim() && !['localhost','127.0.0.1'].includes(new URL(provider.apiUrl).hostname)) throw new Error('请填写 API Key。');
  if (isAIProvider(provider) && !provider.model.trim()) throw new Error('请选择或填写模型名称。');
  if (provider.type==='baidu' && !provider.appId.trim()) throw new Error('百度翻译需要 APP ID 和密钥。');
}
