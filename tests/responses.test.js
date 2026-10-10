import test from 'node:test';
import assert from 'node:assert/strict';
import {chatEndpoint,responsesBody,extractResponseText,translate,fetchModels,aiMessages} from '../extension/src/api.js';
import {DEFAULT_SETTINGS,isAIProvider,validateProvider} from '../extension/src/config.js';

const provider={name:'Responses test',type:'responses',apiUrl:'https://api.example/v1/responses/',apiKey:'secret',model:'translator'};
const segments=[{id:'a',text:'hello world',context:'A greeting'}];
const settings={...DEFAULT_SETTINGS,proofread:true};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const result=text=>({status:'completed',output:[
  {type:'reasoning',summary:[{type:'summary_text',text:'Do not leak this reasoning'}]},
  {type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'I will explain this phrase'}]},
  {type:'message',role:'assistant',status:'completed',phase:'final_answer',content:[{type:'output_text',text:JSON.stringify({translations:[{id:'a',text}]})}]}
]});

test('Responses endpoints and models normalize base addresses and full API URLs',()=>{
  for(const base of ['https://api.example/v1','https://api.example/v1/','https://api.example/v1/responses','https://api.example/v1/responses/','https://api.example/v1/chat/completions','https://api.example/v1/models']) {
    assert.equal(chatEndpoint(base,'responses'),'https://api.example/v1/responses');
    assert.equal(chatEndpoint(base,'models'),'https://api.example/v1/models');
    assert.equal(chatEndpoint(base),'https://api.example/v1/chat/completions');
  }
});

test('Responses bodies use instructions and input_text, disable storage and keep source data separate',()=>{
  const body=responsesBody(provider.model,aiMessages(segments,settings,{title:'Page title'}));
  assert.equal(body.model,'translator');assert.equal(body.stream,false);assert.equal(body.store,false);
  assert.match(body.instructions,/translation-only agent/);assert.match(body.instructions,/silently review/);
  assert.equal(body.messages,undefined);assert.equal(body.previous_response_id,undefined);assert.equal(body.tools,undefined);
  assert.equal(body.input[0].role,'user');assert.equal(body.input[0].content[0].type,'input_text');
  assert.equal(JSON.parse(body.input[0].content[0].text).segments[0].text,'hello world');
});

test('Responses text extraction reads all final parts and ignores reasoning, tools, commentary and convenience text when structured output exists',()=>{
  const data=result('你好世界'),text=data.output[2].content[0].text;
  data.output[2].content=[{type:'output_text',text:text.slice(0,25)},{type:'output_text',text:text.slice(25)}];
  data.output.unshift({type:'function_call',arguments:'Unrelated tool content'});
  data.output_text='Unrelated proxy summary';
  assert.equal(extractResponseText(data),text);
  assert.equal(extractResponseText({output_text:text}),text);
  assert.throws(()=>extractResponseText({output:[],output_text:text}),/未返回最终文本/);
});

test('Responses reject incomplete output, refusals, service errors and reasoning-only responses',()=>{
  const incomplete=result('你好世界');incomplete.output[2].status='incomplete';
  const refusal=result('你好世界');refusal.output[2].content.unshift({type:'refusal',refusal:'secret raw error'});
  for(const data of [null,{error:{message:'secret raw error'}},{...result('你好世界'),status:'failed'},
    {...result('你好世界'),status:'incomplete'},incomplete,refusal,
    {output:[{type:'reasoning',summary:[{text:'explanation'}]}]}
  ]) assert.throws(()=>extractResponseText(data),error=>!error.message.includes('secret raw error'));
});

test('Responses translation runs independent delivery review and returns pure translated text',async()=>{
  const calls=[];
  const output=await translate(provider,segments,settings,{title:'Greeting'},undefined,async(url,options)=>{
    assert.equal(url,'https://api.example/v1/responses');assert.equal(options.headers.Authorization,'Bearer secret');
    const body=JSON.parse(options.body);calls.push(body);assert.equal(body.store,false);
    return json(result('你好世界'));
  });
  assert.deepEqual(output,[{id:'a',text:'你好世界'}]);assert.equal(calls.length,2);
  assert.match(calls[1].instructions,/DELIVERY REVIEW/);
  assert.equal(JSON.parse(calls[1].input[0].content[0].text).segments[0].candidate,'你好世界');
  assert.ok(!JSON.stringify(calls).includes('Do not leak this reasoning'));
});

test('Responses repair injected explanation and refuse persistent monologue',async()=>{
  let calls=0;
  const output=await translate(provider,segments,settings,{},undefined,async(url,options)=>{
    calls++;
    if(calls===1) return json(result('这两个单词的意思是你好世界，是编程初学者常用的文本。'));
    if(calls===2) assert.match(JSON.parse(options.body).instructions,/REPAIR REQUIRED/);
    return json(result('你好世界'));
  });assert.equal(output[0].text,'你好世界');assert.equal(calls,3);
  calls=0;
  await assert.rejects(()=>translate(provider,segments,settings,{},undefined,async()=>{calls++;return json(result('译文：你好世界'));}),/已保留原文/);
  assert.equal(calls,2);
});

test('Responses providers require models and fetch the upstream model list from a full endpoint',async()=>{
  assert.equal(isAIProvider(provider),true);assert.equal(isAIProvider({type:'ai'}),true);assert.equal(isAIProvider({type:'deepl'}),false);
  assert.throws(()=>validateProvider({...provider,model:''}),/模型/);
  const models=await fetchModels(provider,async(url,options)=>{
    assert.equal(url,'https://api.example/v1/models');assert.equal(options.headers.Authorization,'Bearer secret');
    return json({data:[{id:'translator'}]});
  });assert.deepEqual(models,['translator']);
});

test('Responses cancellation and authentication errors do not retry as translation failures',async()=>{
  let calls=0;
  await assert.rejects(()=>translate(provider,segments,settings,{},AbortSignal.abort(),async()=>{calls++;return json(result('你好世界'));}),/停止/);assert.equal(calls,0);
  await assert.rejects(()=>translate(provider,segments,settings,{},undefined,async()=>{calls++;return new Response('{}',{status:401});}),/401/);assert.equal(calls,1);
});
