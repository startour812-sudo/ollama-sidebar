import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {RpcClient} from '../src/rpc';
import {prepareRuntime,defaultRuntimeRoot} from '../src/runtime';
async function main(){
const state=path.resolve(__dirname,'../.test-state/live'),cwd=path.join(state,'workspace');
await mkdir(cwd,{recursive:true});await writeFile(path.join(cwd,'input.txt'),'SELF_AGENT_EXTENSION_OK\n');
const runtime=await prepareRuntime({runtimeRoot:defaultRuntimeRoot(),ollamaExecutable:'ollama',ollamaUrl:'http://127.0.0.1:11435',autoStartOllama:true,model:'gemma4:e4b',modelCatalog:'',defaultModelCatalog:path.resolve(__dirname,'../resources/gemma-models.json'),contextLength:16384},path.join(state,'codex'),console.log);
const rpc=new RpcClient();const events:any[]=[];let finish:(v:any)=>void;
const completed=new Promise<any>(resolve=>{finish=resolve;});
rpc.on('log',s=>process.stderr.write(s));rpc.on('notification',m=>{events.push(m);if(['turn/started','item/completed','turn/completed'].includes(m.method))console.log(JSON.stringify(m));if(m.method==='turn/completed')finish(m.params);});
rpc.on('request',m=>{
 const expected='Copy-Item -LiteralPath input.txt -Destination output.txt; Get-Content -LiteralPath output.txt';
 const permitted=m.method==='item/commandExecution/requestApproval'&&m.params.cwd===cwd&&m.params.command?.endsWith("-Command '"+expected+"'")&&m.params.commandActions?.length===1&&m.params.commandActions[0].command===expected;
 console.log('Approval request',permitted?'approved exact fixture command':'declined',JSON.stringify(m));rpc.respond(m.id,{decision:permitted?'accept':'decline'});
});
rpc.start(runtime.binary,['app-server','--listen','stdio://'],cwd,runtime.env);
const timeout=setTimeout(()=>{rpc.dispose();console.error('Live test timed out');process.exitCode=1;finish({turn:{status:'timeout'}});},600000);
try{
 await rpc.request('initialize',{clientInfo:{name:'self_agent_test',version:'0.1.0'},capabilities:{experimentalApi:false}});rpc.notify('initialized');
 const {thread}=await rpc.request('thread/start',{model:'gemma4:e4b',modelProvider:'self_agent_ollama',cwd,approvalPolicy:'on-request',sandbox:'workspace-write'});
 await rpc.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Use exec_command with only cmd to run this PowerShell command: Copy-Item -LiteralPath input.txt -Destination output.txt; Get-Content -LiteralPath output.txt . Then reply with the file content. Do not modify any other files.',text_elements:[]}],effort:'none',summary:'none'});
 const done=await completed;assert.equal(done.turn.status,'completed');assert.equal((await readFile(path.join(cwd,'output.txt'),'utf8')).trim(),'SELF_AGENT_EXTENSION_OK');
 const resumed=await rpc.request('thread/resume',{threadId:thread.id});assert.equal(resumed.thread.id,thread.id);
 await writeFile(path.join(state,'result.json'),JSON.stringify({passed:true,threadId:thread.id,events},null,2));console.log('PASS: live Gemma file tool and thread resume');
}finally{clearTimeout(timeout);rpc.dispose();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
