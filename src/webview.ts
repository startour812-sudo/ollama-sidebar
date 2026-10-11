import { marked } from 'marked';
import DOMPurify from 'dompurify';
declare function acquireVsCodeApi():{postMessage:(m:unknown)=>void;getState:()=>any;setState:(s:unknown)=>void};
const vscode=acquireVsCodeApi();
const $=(id:string)=>document.getElementById(id)!;
const input=$('prompt') as HTMLTextAreaElement;
let state:any={busy:false,attachments:[],approvals:[]};
let composing=false;
input.value=vscode.getState()?.draft||'';
input.addEventListener('input',()=>vscode.setState({draft:input.value}));
input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
function send(){if(!state.busy&&input.value.trim())vscode.postMessage({type:'send',text:input.value});}
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing){e.preventDefault();send();}});
$('send').onclick=send;
for(const id of ['stop','new','history','logs','model'])$(id).onclick=()=>vscode.postMessage({type:id});
for(const id of ['file','selection'])$(id).onclick=()=>vscode.postMessage({type:'attach',kind:id});
function button(label:string,fn:()=>void){const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b;}
function render(){
  $('model').textContent=(state.model||'gemma4:e4b')+' ▾';$('folder').textContent=state.chat?.cwd?.split(/[\\/]/).pop()||'프로젝트';
  $('folder').title=state.chat?.cwd||'';const list=$('messages'),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;
  list.replaceChildren();
  if(!state.chat?.entries?.length){const empty=document.createElement('div');empty.className='empty';const title=document.createElement('h2');title.textContent='안녕하세요!';const p=document.createElement('p');p.textContent='무엇을 도와드릴까요? 궁금한 점이나 필요한 작업을 편하게 말씀해 주세요.';empty.append(title,p);list.append(empty);}
  for(const e of state.chat?.entries||[]){
    const el=document.createElement(e.kind==='tool'?'details':'article');el.className='entry '+e.kind;
    const heading=document.createElement(e.kind==='tool'?'summary':'div');heading.className='label';heading.textContent=e.kind==='user'?'YOU':e.kind==='assistant'?'OLLAMA SIDEBAR':e.kind==='tool'?'실행 · '+(e.status||'진행 중'):'알림';el.append(heading);
    const content=document.createElement(e.kind==='tool'?'pre':'div');
    if(e.kind==='assistant')content.innerHTML=DOMPurify.sanitize(marked.parse(e.text,{async:false}) as string,{ALLOWED_TAGS:['p','br','strong','em','del','code','pre','ul','ol','li','h1','h2','h3','h4','blockquote','table','thead','tbody','tr','th','td','hr'],ALLOWED_ATTR:[]});
    else content.textContent=e.text;
    el.append(content);for(const file of e.files||[]){el.append(button('파일 열기: '+file.split(/[\\/]/).pop(),()=>vscode.postMessage({type:'openFile',path:file})));el.append(button('Git 변경 보기',()=>vscode.postMessage({type:'diffFile',path:file})));}
    list.append(el);
  }
  if(bottom)list.scrollTop=list.scrollHeight;
  $('attachments').replaceChildren(...(state.attachments||[]).map((name:string,index:number)=>button('📎 '+name.split(/[\\/]/).pop()+' ×',()=>vscode.postMessage({type:'removeAttachment',index}))));
  $('approvals').replaceChildren();
  for(const a of state.approvals||[]){
    const card=document.createElement('section');card.className='approval';const title=document.createElement('strong');title.textContent='작업 승인 요청';
    const body=document.createElement('pre');const item=state.chat?.entries?.find((e:any)=>e.id===a.params.itemId);
    body.textContent=[a.params.reason,a.params.command||item?.text,a.params.cwd,a.params.grantRoot,a.params.permissions?JSON.stringify(a.params.permissions,null,2):null].filter(Boolean).join('\n');
    card.append(title,body,button('이번 작업 승인',()=>vscode.postMessage({type:'approve',key:a.key,decision:'accept'})),button('거절',()=>vscode.postMessage({type:'approve',key:a.key,decision:'decline'})));$('approvals').append(card);
  }
  for(const id of ['send','new','history','file','selection'])($(id) as HTMLButtonElement).disabled=!!state.busy;
  ($('model') as HTMLButtonElement).disabled=!!state.busy||!!state.choosingModel;
  ($('send') as HTMLButtonElement).disabled=!!state.busy||!!state.choosingModel;
  $('stop').hidden=!state.busy;updateStatus();
}
function updateStatus(){const elapsed=state.busy&&state.started?' · '+Math.floor((Date.now()-state.started)/1000)+'초':'';$('status').textContent=(state.status||'준비됨')+elapsed;$('status').classList.toggle('busy',!!state.busy);}
setInterval(updateStatus,1000);
window.addEventListener('message',e=>{if(e.data.type==='state'){state=e.data;render();}else if(e.data.type==='sent'){input.value='';vscode.setState({draft:''});}else if(e.data.type==='focus')input.focus();});
vscode.postMessage({type:'ready'});
