import test from 'node:test';
import assert from 'node:assert/strict';
import {RequestQueue} from '../extension/src/request-queue.js';
import {requestJSON,translate,effectiveProtocol} from '../extension/src/api.js';
import {DEFAULT_SETTINGS,normalizeSettings} from '../extension/src/config.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const provider={name:'Gateway',type:'ai',apiUrl:'https://compatibility.example/v1',apiKey:'secret',model:'model'};
const segments=[{id:'1',text:'hello world'}];

test('network queue serializes separate jobs and drops cancelled pending work',async()=>{
  const queue=new RequestQueue(),order=[];let active=0,max=0;
  const work=id=>async()=>{order.push(id);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,30));active--;return id;};
  const first=queue.run(work(1),undefined,0),controller=new AbortController();
  const aborted=queue.run(work(2),controller.signal,0);const third=queue.run(work(3),undefined,0);
  const rejection=assert.rejects(aborted,/停止/);controller.abort();
  assert.deepEqual(await Promise.all([first,third]),[1,3]);await rejection;assert.deepEqual(order,[1,3]);assert.equal(max,1);
});
test('409 admission failure switches to Responses once and remembers successful protocol',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push(url);const body=JSON.parse(options.body);
    if(url.endsWith('/chat/completions')) return json({error:{message:'mint_host_gate_unavailable: mint admission unavailable; no automatic retry',retryable:false}},409);
    assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');
    return json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({translations:[{id:'1',text:'你好世界'}]})}]}]});
  };
  assert.equal((await translate(provider,segments,{...DEFAULT_SETTINGS,requestInterval:0},{},undefined,fetcher))[0].text,'你好世界');
  assert.equal(effectiveProtocol(provider),'responses');
  await translate(provider,segments,{...DEFAULT_SETTINGS,requestInterval:0},{},undefined,fetcher);
  assert.deepEqual(calls,['https://compatibility.example/v1/chat/completions','https://compatibility.example/v1/responses','https://compatibility.example/v1/responses']);
});
test('generic nonretryable 409 fails immediately with sanitized error code',async()=>{
  let calls=0;
  await assert.rejects(()=>requestJSON('https://api.example',{},undefined,async()=>{calls++;return json({error:{code:'model_unavailable',message:'secret full body',retryable:false}},409);},0),error=>error.status===409 && error.message.includes('model_unavailable') && !error.message.includes('secret'));
  assert.equal(calls,1);
});
test('transient 409 backs off and succeeds; cancellation interrupts the wait',async()=>{
  let calls=0;
  const result=await requestJSON('https://api.example',{},undefined,async()=>++calls===1?json({error:{code:'concurrency_limit',retryable:true}},409):json({ok:true}),0);
  assert.equal(result.ok,true);assert.equal(calls,2);
  const controller=new AbortController();calls=0;
  const pending=requestJSON('https://api.example',{},controller.signal,async()=>{calls++;setTimeout(()=>controller.abort(),20);return json({error:{retryable:true}},409);},0);
  await assert.rejects(pending,/停止/);assert.equal(calls,1);
});
test('unsupported JSON schema falls back to JSON mode, while output validation stays mandatory',async()=>{
  let calls=0;
  const output=await translate({...provider,apiUrl:'https://legacy.example/v1'},segments,{...DEFAULT_SETTINGS,requestInterval:0},{},undefined,async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    if(calls===1) {assert.equal(body.response_format.type,'json_schema');return json({error:{param:'response_format',message:'json_schema is not supported'}},400);}
    assert.equal(body.response_format.type,'json_object');return json({choices:[{message:{content:JSON.stringify({translations:[{id:'1',text:'你好世界'}]})}}]});
  });assert.equal(calls,2);assert.equal(output[0].text,'你好世界');
  await translate({...provider,apiUrl:'https://legacy.example/v1'},segments,{...DEFAULT_SETTINGS,requestInterval:0},{},undefined,async(url,options)=>{
    assert.equal(JSON.parse(options.body).response_format.type,'json_object');return json({choices:[{message:{content:JSON.stringify({translations:[{id:'1',text:'你好世界'}]})}}]});
  });
});

test('failed Responses fallback does not poison the next protocol selection',async()=>{
  const failed={...provider,apiUrl:'https://failed.example/v1'};
  await assert.rejects(()=>translate(failed,segments,{...DEFAULT_SETTINGS,requestInterval:0},{},undefined,async url=>url.endsWith('/chat/completions')?json({error:{code:'mint_host_gate_unavailable',retryable:false}},409):json({},404)),/404/);
  assert.equal(effectiveProtocol(failed),'ai');
});

test('custom and imported request settings preserve integers and clamp unsafe bounds',()=>{
  assert.deepEqual([normalizeSettings({batchSize:999,requestInterval:-10}).batchSize,normalizeSettings({batchSize:999,requestInterval:-10}).requestInterval],[64,0]);
  assert.equal(normalizeSettings({batchSize:NaN}).batchSize,16);
  assert.equal(normalizeSettings({requestInterval:Infinity}).requestInterval,350);
  assert.equal(normalizeSettings({concurrency:50}).concurrency,20);
  assert.equal(normalizeSettings({requestTimeout:1}).requestTimeout,10);
  assert.equal(normalizeSettings({requestTimeout:1000}).requestTimeout,600);
  const custom=normalizeSettings({batchSize:19,concurrency:6,requestTimeout:173,requestInterval:425});
  assert.deepEqual([custom.batchSize,custom.concurrency,custom.requestTimeout,custom.requestInterval],[19,6,173,425]);
  assert.deepEqual([normalizeSettings({}).concurrency,normalizeSettings({}).requestTimeout],[5,120]);
});

test('shared queue allows five concurrent requests, bounds active work and preserves start spacing',async()=>{
  const queue=new RequestQueue(5);let active=0,max=0;const started=[];
  const jobs=Array.from({length:13},(_,id)=>queue.run(async()=>{
    started.push(Date.now());max=Math.max(max,++active);
    await new Promise(r=>setTimeout(r,85));active--;return id;
  },undefined,10));
  assert.deepEqual(await Promise.all(jobs),Array.from({length:13},(_,i)=>i));
  assert.equal(max,5);
  for(let i=1;i<started.length;i++) assert.ok(started[i]-started[i-1]>=8,'Requests must be spaced apart');
});

test('lowering the queue limit lets active work drain and blocks excess new starts',async()=>{
  const queue=new RequestQueue(5);const release=[];let active=0,maxAfterChange=0,lowered=false;
  const jobs=Array.from({length:8},()=>queue.run(async()=>{
    active++;if(lowered) maxAfterChange=Math.max(maxAfterChange,active);
    await new Promise(r=>release.push(r));active--;
  },undefined,0));
  await new Promise(r=>setTimeout(r,0));assert.equal(active,5);
  lowered=true;queue.setConcurrency(2);
  release.splice(0).forEach(done=>done());
  await new Promise(r=>setTimeout(r,0));assert.equal(active,2);
  release.splice(0).forEach(done=>done());
  await new Promise(r=>setTimeout(r,0));release.splice(0).forEach(done=>done());
  await Promise.all(jobs);assert.equal(maxAfterChange,2);
});
