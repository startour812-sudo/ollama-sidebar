import test from 'node:test';
import assert from 'node:assert/strict';
import {requireTools,RuntimeSettings} from '../src/runtime';

test('model selection validates Ollama tool capability and server errors',async()=>{
 const original=globalThis.fetch;
 const settings={ollamaUrl:'http://127.0.0.1:11435'} as RuntimeSettings;
 try{
  globalThis.fetch=async(_url,options)=>{assert.equal(JSON.parse(options!.body as string).model,'candidate:latest');return new Response(JSON.stringify({capabilities:['completion','tools']}));};
  await requireTools(settings,'candidate:latest');
  globalThis.fetch=async()=>new Response(JSON.stringify({capabilities:['completion']}));
  await assert.rejects(()=>requireTools(settings,'candidate:latest'),/도구 호출/);
  globalThis.fetch=async()=>new Response('',{status:500});
  await assert.rejects(()=>requireTools(settings,'candidate:latest'),/모델 정보/);
 }finally{globalThis.fetch=original;}
});
