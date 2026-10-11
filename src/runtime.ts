import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
export function defaultRuntimeRoot(){return path.join(process.env.LOCALAPPDATA||path.join(homedir(),'AppData','Local'),'SelfAgent');}
export interface RuntimeSettings {runtimeRoot:string; ollamaExecutable:string; ollamaUrl:string; autoStartOllama:boolean; model:string; modelCatalog:string; defaultModelCatalog:string; contextLength:number}
export function executableAt(root:string){return path.join(root,'.runtime/vendor/x86_64-pc-windows-msvc/bin/codex.exe');}
export function localEndpoint(value:string){const u=new URL(value);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Ollama 주소는 로컬 HTTP 서버 주소여야 합니다.');return u.origin;}
export async function prepareRuntime(s:RuntimeSettings,state:string,log:(s:string)=>void) {
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('첫 버전은 Windows x64를 지원합니다.');
  const binary=executableAt(s.runtimeRoot);if(!existsSync(binary))throw new Error(`런타임이 없습니다. 프로젝트의 scripts/install-runtime.ps1을 실행하여 ${s.runtimeRoot}에 설치하세요.`);
  const version=await promisify(execFile)(binary,['--version'],{windowsHide:true});
  if(!/\b0\.150\.1\b/.test(version.stdout))throw new Error(`지원하지 않는 Codex 버전: ${version.stdout.trim()}. 지원 버전은 0.150.1입니다.`);
  const endpoint=localEndpoint(s.ollamaUrl);
  await mkdir(state,{recursive:true});
  const catalog=JSON.parse(await readFile(s.modelCatalog||s.defaultModelCatalog,'utf8'));
  let model=catalog.models?.find((m:any)=>m.slug===s.model);
  if(!model){
    if(s.modelCatalog)throw new Error('사용자 지정 모델 정보 파일에 선택한 모델이 없습니다.');
    if(!catalog.models?.[0])throw new Error('기본 모델 정보가 없습니다.');
    model=structuredClone(catalog.models[0]);model.slug=s.model;model.display_name=s.model;
    model.description='Local Ollama model; direct tools, thinking disabled.';
    model.base_instructions=model.base_instructions.replaceAll('with Gemma 4','with a local Ollama model');
    model.model_messages.instructions_template=model.base_instructions;
  }
  model.context_window=s.contextLength;model.auto_compact_token_limit=Math.floor(s.contextLength*.73);
  await writeFile(path.join(state,'models.json'),JSON.stringify({models:[model]},null,2));
  const q=(v:string)=>JSON.stringify(v.replaceAll('\\','/'));
  await writeFile(path.join(state,'config.toml'),`model = ${q(s.model)}\nmodel_provider = "self_agent_ollama"\nmodel_catalog_json = ${q(path.join(state,'models.json'))}\nmodel_context_window = ${s.contextLength}\nmodel_auto_compact_token_limit = ${Math.floor(s.contextLength*.73)}\nmodel_reasoning_effort = "none"\nmodel_reasoning_summary = "none"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nweb_search = "disabled"\n[model_providers.self_agent_ollama]\nname = "Ollama Sidebar Ollama"\nbase_url = ${q(endpoint+'/v1')}\nwire_api = "responses"\nrequires_openai_auth = false\nstream_idle_timeout_ms = 600000\nrequest_max_retries = 1\nstream_max_retries = 1\n[features]\nplugins = false\nrecommended_plugins = false\nmulti_agent = false\n[skills]\ninclude_instructions = false\n[analytics]\nenabled = false\n[windows]\nsandbox = "unelevated"\n`);
  const models=await listModels(s,state,log);
  if(!models.includes(s.model))throw new Error(`모델이 없습니다. 터미널에서 ollama pull ${s.model} 실행 후 다시 시도하세요.`);
  await requireTools(s,s.model);
  return {binary,env:{...process.env,CODEX_HOME:state,PATH:path.dirname(binary)+path.delimiter+(process.env.PATH||'')}};
}
export async function listModels(s:RuntimeSettings,state:string,log:(s:string)=>void):Promise<string[]>{
  const endpoint=localEndpoint(s.ollamaUrl);await mkdir(state,{recursive:true});
  const ready=async()=>{try{return (await fetch(endpoint+'/api/version',{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}};
  if(!await ready()){
    if(!s.autoStartOllama)throw new Error('Ollama 서버를 시작하거나 자동 시작을 켜주세요.');
    log('Ollama 서버 시작 중');
    const out=openSync(path.join(state,'ollama.log'),'a');
    const server=spawn(s.ollamaExecutable,['serve'],{windowsHide:true,detached:true,stdio:['ignore',out,out],env:{...process.env,OLLAMA_HOST:new URL(endpoint).host,OLLAMA_CONTEXT_LENGTH:String(s.contextLength),OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_KEEP_ALIVE:'5m',OLLAMA_NO_CLOUD:'1'}});
    let error:Error|undefined;server.on('error',e=>{error=e;});server.unref();closeSync(out);
    for(let i=0;i<60&&!await ready();i++){if(error)throw error;await new Promise(r=>setTimeout(r,250));}
    if(!await ready())throw new Error('Ollama 시작 실패. 출력 로그를 확인하세요.');
  }
  const response=await fetch(endpoint+'/api/tags',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Ollama 모델 목록 요청 실패: ${response.status}`);
  const tags=await response.json() as any;
  return [...new Set<string>((tags.models||[]).map((m:any)=>m.name))].sort();
}
export async function requireTools(s:RuntimeSettings,model:string){
  const response=await fetch(localEndpoint(s.ollamaUrl)+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('모델 정보를 가져오지 못했습니다.');
  const info=await response.json() as {capabilities?:string[]};
  if(!info.capabilities?.includes('tools'))throw new Error('이 모델은 Ollama 도구 호출을 지원하지 않아 에이전트 모델로 사용할 수 없습니다.');
}
