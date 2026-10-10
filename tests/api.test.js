import test from 'node:test';
import assert from 'node:assert/strict';
import {md5} from '../extension/src/md5.js';
import {translate,parseAIResult,aiMessages,chatEndpoint,languageCode,fetchModels,decodeEntities,requestJSON} from '../extension/src/api.js';
import {DEFAULT_SETTINGS,providerOrigin} from '../extension/src/config.js';
const segments=[{id:'a',text:'Hello',context:'Greeting'},{id:'b',text:'World',context:'Planet'}];
const provider={id:'p',name:'test',type:'ai',apiUrl:'https://api.example/v1',apiKey:'secret',model:'model'};
const settings={...DEFAULT_SETTINGS};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('MD5 follows RFC 1321 vectors and UTF-8 Baidu signatures',()=>{
  assert.equal(md5(''),'d41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'),'900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('message digest'),'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(md5('中文'),'a7bac2239fcdcb3a067903d8077c4a07');
});
test('AI response IDs control placement even if the model reorders segments',()=>{
  const output=parseAIResult('```json\n{"translations":[{"id":"b","text":"世界"},{"id":"a","text":"你好"}]}\n```',segments);
  assert.deepEqual(output,[{id:'a',text:'你好'},{id:'b',text:'世界'}]);
  for(const translations of [[{id:'a',text:'你好'}],[{id:'a',text:'你好'},{id:'a',text:'世界'}],[{id:'x',text:'你好'},{id:'b',text:'世界'}],[{id:'a',text:''},{id:'b',text:'世界'}]]) assert.throws(()=>parseAIResult(JSON.stringify({translations}),segments));
});
test('AI quality controls affect prompts and context data, never credentials',()=>{
  const enabled=aiMessages(segments,{...settings,glossary:'World = 世界',proofread:true},{title:'Title'});
  assert.match(enabled[0].content,/untrusted/);assert.match(enabled[0].content,/review each draft/);
  const payload=JSON.parse(enabled[1].content);assert.equal(payload.pageTitle,'Title');assert.equal(payload.segments[0].context,'Greeting');assert.equal(payload.glossary,'World = 世界');
  const disabled=aiMessages(segments,{...settings,context:false,terminology:false,preserveNames:false,proofread:false},{title:'Secret title'});
  assert.equal(JSON.parse(disabled[1].content).pageTitle,undefined);assert.equal(JSON.parse(disabled[1].content).glossary,undefined);assert.equal(JSON.parse(disabled[1].content).segments[0].context,undefined);
});
test('AI endpoint normalization and model retrieval',async()=>{
  assert.equal(chatEndpoint('https://api.example/v1/chat/completions'),'https://api.example/v1/chat/completions');
  assert.equal(chatEndpoint('https://api.example/v1/','models'),'https://api.example/v1/models');
  const models=await fetchModels(provider,async(url,options)=>{assert.equal(url,'https://api.example/v1/models');assert.equal(options.headers.Authorization,'Bearer secret');return json({data:[{id:'z'},{id:'a'}]});});
  assert.deepEqual(models,['a','z']);
});
test('Google uses official Basic API with automatic source detection and plain text',async()=>{
  const output=await translate({...provider,type:'google'},segments,settings,{},undefined,async(url,options)=>{
    assert.equal(new URL(url).searchParams.get('key'),'secret');
    const body=JSON.parse(options.body);assert.equal(body.source,undefined);assert.equal(body.format,'text');assert.equal(body.target,'zh-CN');assert.deepEqual(body.q,['Hello','World']);
    return json({data:{translations:[{translatedText:'你好 &amp; 再见'},{translatedText:'世界'}]}});
  });
  assert.equal(output[0].text,'你好 & 再见');
  assert.equal(decodeEntities('&#x1F30D; &#39; &lt;img&gt;'),'🌍 \' <img>');
});
test('DeepL Free/Pro auth and source/target variants follow official schema',async()=>{
  await translate({...provider,type:'deepl'},segments,{...settings,source:'zh-TW',target:'zh-CN'}, {},undefined,async(url,options)=>{
    assert.equal(options.headers.Authorization,'DeepL-Auth-Key secret');
    const body=JSON.parse(options.body);assert.equal(body.source_lang,'ZH');assert.equal(body.target_lang,'ZH-HANS');assert.equal(body.context,undefined);assert.deepEqual(body.text,['Hello','World']);
    return json({translations:[{text:'你好'},{text:'世界'}]});
  });
  assert.equal(languageCode('zh-TW','deepl'),'ZH-HANT');
});
test('Baidu signs the exact UTF-8 text before encoding and preserves multiline response',async()=>{
  const input=[{id:'a',text:'Hello\n中文'}];
  const output=await translate({...provider,type:'baidu',appId:'app-id'},input,settings,{},undefined,async(url,options)=>{
    const body=options.body;assert.equal(body.get('q'),'Hello\n中文');assert.equal(body.get('to'),'zh');assert.equal(body.get('from'),'auto');
    assert.equal(body.get('sign'),md5('app-id'+body.get('q')+body.get('salt')+'secret'));
    return json({trans_result:[{dst:'你好'},{dst:'中文'}]});
  });assert.equal(output[0].text,'你好\n中文');
  await assert.rejects(()=>translate({...provider,type:'baidu',appId:'app-id'},input,settings,{},undefined,async()=>json({error_code:'54001'})),/签名/);
});
test('API errors do not echo keys, cancellation blocks fetches, and partial output fails',async()=>{
  await assert.rejects(()=>requestJSON('https://api.example',{},undefined,async()=>new Response('secret',{status:401})),error=>error.message.includes('无效')&&!error.message.includes('secret'));
  const signal=AbortSignal.abort();let called=false;
  await assert.rejects(()=>requestJSON('https://api.example',{},signal,async()=>{called=true;}),/停止/);assert.equal(called,false);
  await assert.rejects(()=>translate({...provider,type:'google'},segments,settings,{},undefined,async()=>json({data:{translations:[{translatedText:'你好'}]}})),/数量/);
});
test('custom endpoints require HTTPS or loopback and cannot carry query credentials',()=>{
  assert.equal(providerOrigin({apiUrl:'https://api.example/v1'}),'https://api.example/*');
  assert.equal(providerOrigin({apiUrl:'http://localhost:3333/v1'}),'http://localhost:3333/*');
  for(const apiUrl of ['http://api.example','https://a:b@api.example','https://api.example?key=secret','file:///test']) assert.throws(()=>providerOrigin({apiUrl}));
});
