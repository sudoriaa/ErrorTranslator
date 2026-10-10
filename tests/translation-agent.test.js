import test from 'node:test';
import assert from 'node:assert/strict';
import {translate,parseAIResult,aiMessages} from '../extension/src/api.js';
import {validateTranslationOnly} from '../extension/src/translation-agent.js';
import {DEFAULT_SETTINGS} from '../extension/src/config.js';

const provider={name:'test AI',type:'ai',apiUrl:'https://api.example/v1',apiKey:'secret',model:'translator'};
const source=[{id:'greeting',text:'hello world',context:'An introductory programming article.'}];
const settings={...DEFAULT_SETTINGS,proofread:true,requestInterval:0};
function reply(text,extra={}) {
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:[{id:'greeting',text}]}),...extra}}]}),{headers:{'Content-Type':'application/json'}});
}

test('mandatory contract prevents tutor responses, questions being answered and visible thought',()=>{
  const prompt=aiMessages(source,settings,{title:'Hello world tutorial'})[0].content;
  assert.match(prompt,/translation-only agent/);assert.match(prompt,/你好世界/);assert.match(prompt,/Do not answer the question/);assert.match(prompt,/Think and check silently/);
  assert.match(prompt,/SOURCE itself contains an explanation/);
});

test('hello world is delivered as 你好世界 after the enabled independent review',async()=>{
  const calls=[];
  const output=await translate(provider,source,settings,{},undefined,async(url,options)=>{
    const messages=JSON.parse(options.body).messages;calls.push(messages);
    return reply('你好世界',{reasoning_content:'This is an explanation about a programming tutorial.'});
  });
  assert.deepEqual(output,[{id:'greeting',text:'你好世界'}]);assert.equal(calls.length,2);
  assert.match(calls[1][0].content,/DELIVERY REVIEW/);
  const reviewed=JSON.parse(calls[1][1].content).segments[0];
  assert.equal(reviewed.text,'hello world');assert.equal(reviewed.candidate,'你好世界');
  assert.ok(!JSON.stringify(calls).includes('This is an explanation'));
});

test('default batch returns all element translations in a single request with strict schema',async()=>{
  const input=[{id:'1',text:'hello world'},{id:'2',text:'Good morning'}];let calls=0;
  const output=await translate(provider,input,{...settings,proofread:false},{},undefined,async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
    const request=JSON.parse(body.messages[1].content);assert.equal(request.segments.length,2);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:[{id:'2',text:'早上好'},{id:'1',text:'你好世界'}]})}}]}));
  });assert.equal(calls,1);assert.deepEqual(output,[{id:'1',text:'你好世界'},{id:'2',text:'早上好'}]);
});

test('the user example of invented explanation is rejected and corrected before delivery',async()=>{
  let calls=0;
  const output=await translate(provider,source,settings,{},undefined,async(url,options)=>{
    calls++;
    if(calls===1) return reply('这两个单词的意思是你好世界，是计算机编程初学者常用的文本。');
    if(calls===2) assert.match(JSON.parse(options.body).messages[0].content,/REPAIR REQUIRED/);
    return reply('你好世界');
  });
  assert.deepEqual(output,[{id:'greeting',text:'你好世界'}]);assert.equal(calls,3);
});

test('source-aware delivery review corrects unrelated prose without relying on keyword matching',async()=>{
  let calls=0;
  const output=await translate(provider,source,settings,{},undefined,async(url,options)=>{
    calls++;
    if(calls===1) return reply('你好世界。初学者经常在编程时使用它。');
    const segment=JSON.parse(JSON.parse(options.body).messages[1].content).segments[0];
    assert.equal(segment.text,'hello world');assert.match(segment.candidate,/初学者/);
    return reply('你好世界');
  });assert.equal(output[0].text,'你好世界');assert.equal(calls,2);
});

test('review leakage is corrected; repeated invalid delivery is never returned',async()=>{
  let calls=0;
  const output=await translate(provider,source,settings,{},undefined,async()=>{
    calls++;return reply(calls===2?'译文：你好世界':'你好世界');
  });assert.equal(output[0].text,'你好世界');assert.equal(calls,3);
  calls=0;
  await assert.rejects(()=>translate(provider,source,settings,{},undefined,async()=>{calls++;return reply('作为一个AI，我认为这两个单词的意思是你好世界。');}),/已保留原文/);
  assert.equal(calls,2);
  calls=0;
  await assert.rejects(()=>translate(provider,source,settings,{},undefined,async()=>{calls++;return reply(calls===1?'你好世界':'<think>I need to explain this.</think>你好世界');}),/已保留原文/);
  assert.equal(calls,3);
});

test('source explanations, first-person voice and literal translation labels remain legitimate content',()=>{
  const legitimate=[
    {id:'1',text:'These two words mean hello world and are used by beginning programmers.'},
    {id:'2',text:'I think this is a useful example.'},
    {id:'3',text:'Translation: hello world'},
    {id:'4',text:'As an AI, I have no personal experience.'}
  ];
  const translations=[
    {id:'1',text:'这两个单词的意思是你好世界，是编程初学者使用的文本。'},
    {id:'2',text:'我认为这是一个有用的例子。'},
    {id:'3',text:'译文：你好世界'},
    {id:'4',text:'作为一个AI，我没有亲身经历。'}
  ];assert.deepEqual(validateTranslationOnly(translations,legitimate),translations);
});

test('extra reasoning fields, malformed JSON and foreign segment IDs fail strict parsing',()=>{
  for(const content of [
    'null',
    JSON.stringify({translations:[{id:'greeting',text:'你好世界'}],reasoning:'my explanation'}),
    JSON.stringify({translations:[{id:'greeting',text:'你好世界',analysis:'my explanation'}]}),
    JSON.stringify({translations:[null]}),
    'Here is your translation: {"translations":[{"id":"greeting","text":"你好世界"}]}',
    JSON.stringify({translations:[{id:'wrong',text:'你好世界'}]})
  ]) assert.throws(()=>parseAIResult(content,source));
});

test('authentication and cancellation errors do not trigger delivery retries',async()=>{
  let calls=0;
  await assert.rejects(()=>translate(provider,source,settings,{},undefined,async()=>{calls++;return new Response('{}',{status:401});}),/401/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(()=>translate(provider,source,settings,{},AbortSignal.abort(),async()=>{calls++;return reply('你好世界');}),/停止/);
  assert.equal(calls,0);
});

test('grossly expanded responses cannot pass the local delivery guard',()=>{
  assert.throws(()=>validateTranslationOnly([{id:'greeting',text:'背景知识。'.repeat(100)}],source),/扩写/);
});
