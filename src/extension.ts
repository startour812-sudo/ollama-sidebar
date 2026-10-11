import * as vscode from 'vscode';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { RpcClient, RpcMessage } from './rpc';
import { prepareRuntime, RuntimeSettings, defaultRuntimeRoot, listModels, requireTools } from './runtime';
import { applyEvent, attachmentPrompt, Attachment, Chat } from './state';
import type { ThreadStartParams } from './protocol/v2/ThreadStartParams';
import type { TurnStartParams } from './protocol/v2/TurnStartParams';

export class ChatProvider implements vscode.WebviewViewProvider {
  private view?:vscode.WebviewView;
  private rpc?:RpcClient;
  private chat?:Chat;
  private turn?:string;
  private busy=false;
  private status='준비됨';
  private started=0;
  private attachments:Attachment[]=[];
  private approvals=new Map<string,RpcMessage>();
  private connectedThread?:string;
  private settingsKey='';
  private store=Promise.resolve();
  private output=vscode.window.createOutputChannel('Ollama Sidebar');
  private disposed=false;
  private cancelled=false;
  private persistTimer?:NodeJS.Timeout;
  constructor(private context:vscode.ExtensionContext){}
  private choosingModel=false;
  async chooseModel(){
    if(this.busy||this.choosingModel)return;
    this.choosingModel=true;this.update();
    try{
      const settings=this.settings();
      const models=await listModels(settings,path.join(this.directory(),'codex'),s=>{this.status=s;this.update();});
      if(!models.length)throw new Error('설치된 Ollama 모델이 없습니다. ollama pull로 모델을 설치하세요.');
      const chosen=await vscode.window.showQuickPick(models.map(model=>({label:model,description:model===settings.model?'현재 모델':'',model})),{title:'사용 모델 선택',placeHolder:'변경하면 현재 대화를 저장하고 새 대화를 시작합니다.'});
      if(chosen&&chosen.model!==settings.model){
        await requireTools(settings,chosen.model);
        if(settings.modelCatalog){const catalog=JSON.parse(await readFile(settings.modelCatalog,'utf8'));if(!catalog.models?.some((m:any)=>m.slug===chosen.model))throw new Error('사용자 지정 모델 정보 파일에 선택한 모델이 없습니다.');}
        await this.switchModel(chosen.model);
      }
    }finally{this.choosingModel=false;this.update();}
  }
  private async switchModel(model:string){
    if(this.busy)throw new Error('작업이 끝난 뒤 모델을 변경하세요.');
    await this.save();
    await vscode.workspace.getConfiguration('selfAgent').update('model',model,vscode.ConfigurationTarget.Global);
    this.rpc?.removeAllListeners();this.rpc?.dispose();this.rpc=undefined;this.settingsKey='';
    await this.newChat();this.status=model+' · 새 대화';this.update();
  }
  private settings():RuntimeSettings {
    const c=vscode.workspace.getConfiguration('selfAgent');
    return {runtimeRoot:defaultRuntimeRoot(),ollamaExecutable:c.get('ollamaExecutable','ollama'),ollamaUrl:c.get('ollamaUrl','http://127.0.0.1:11435'),autoStartOllama:c.get('autoStartOllama',true),model:c.get('model','gemma4:e4b'),modelCatalog:c.get('modelCatalog',''),defaultModelCatalog:path.join(this.context.extensionPath,'resources','gemma-models.json'),contextLength:c.get('contextLength',16384)};
  }
  private directory(){const roots=(vscode.workspace.workspaceFolders||[]).map(w=>w.uri.fsPath).join('|');return path.join(this.context.globalStorageUri.fsPath,createHash('sha256').update(roots).digest('hex').slice(0,16));}
  async resolveWebviewView(view:vscode.WebviewView){
    this.view=view;view.webview.options={enableScripts:true,localResourceRoots:[this.context.extensionUri]};
    const uri=(p:string)=>view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,p)).toString();
    const nonce=randomUUID().replaceAll('-','');
    view.webview.html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${view.webview.cspSource} data:;"><link rel="stylesheet" href="${uri('media/style.css')}"></head><body><header><div><strong>OLLAMA SIDEBAR</strong><span class="badge">LOCAL</span></div><div class="toolbar"><button id="history" title="대화 목록">대화 목록</button><button id="new" title="새 대화">＋</button></div></header><section class="info"><button id="model" title="모델 변경" aria-label="사용 모델 변경"></button><span id="folder"></span></section><main id="messages" aria-label="대화"></main><section id="approvals"></section><footer><div id="status" role="status" aria-live="polite"></div><div id="attachments"></div><textarea id="prompt" rows="3" placeholder="이 프로젝트에 대해 요청하세요…" aria-label="메시지"></textarea><div class="toolbar"><button id="file">파일 첨부</button><button id="selection">선택 코드</button><button id="logs">로그</button><span class="spacer"></span><button id="stop" hidden>중단</button><button id="send" class="primary">보내기</button></div><small>로컬 모델 · CPU 추론은 첫 응답까지 시간이 걸릴 수 있습니다.</small></footer><script nonce="${nonce}" src="${uri('dist/webview.js')}"></script></body></html>`;
    view.webview.onDidReceiveMessage(m=>{void this.handle(m).catch(e=>this.error(e));},undefined,this.context.subscriptions);
    view.onDidDispose(()=>{this.view=undefined;},undefined,this.context.subscriptions);
    if(!this.chat){const id=this.context.workspaceState.get<string>('lastChat');if(id)await this.load(id).catch(e=>this.output.appendLine(String(e)));}
    this.update();
  }
  async reveal(){await vscode.commands.executeCommand('selfAgent.chat.focus');this.view?.show?.(true);this.view?.webview.postMessage({type:'focus'});}
  private async handle(m:any){
    if(!m||typeof m.type!=='string')return;
    switch(m.type){
      case 'ready':this.update();break;
      case 'send':if(typeof m.text==='string'&&m.text.trim()&&m.text.length<=32768)await this.send(m.text);break;
      case 'stop':await this.stop();break;
      case 'new':await this.newChat();break;
      case 'model':await this.chooseModel();break;
      case 'history':await this.history();break;
      case 'attach':if(m.kind==='file'||m.kind==='selection')await this.attach(m.kind);break;
      case 'removeAttachment':if(Number.isInteger(m.index))this.attachments.splice(m.index,1);this.update();break;
      case 'approve':if(typeof m.key==='string'&&(m.decision==='accept'||m.decision==='decline'))this.approve(m.key,m.decision);break;
      case 'openFile':if(typeof m.path==='string')await this.openFile(m.path);break;
      case 'diffFile':if(typeof m.path==='string')await this.openFile(m.path,true);break;
      case 'logs':this.output.show();break;
    }
  }
  private update(){
    this.view?.webview.postMessage({type:'state',chat:this.chat,busy:this.busy,status:this.status,started:this.started,model:this.settings().model,choosingModel:this.choosingModel,attachments:this.attachments.map(a=>a.name),approvals:[...this.approvals].map(([key,r])=>({key,method:r.method,params:r.params}))});
    if(this.chat&&!this.persistTimer)this.persistTimer=setTimeout(()=>{this.persistTimer=undefined;void this.save().catch(e=>this.output.appendLine(String(e)));},300);
  }
  private error(e:unknown){const message=e instanceof Error?e.message:String(e);this.status=message;this.output.appendLine(message);if(this.chat)this.chat.entries.push({id:randomUUID(),kind:'error',text:message});this.update();}
  private async save(){
    if(!this.chat)return;const dir=path.join(this.directory(),'chats'),id=this.chat.id,data=JSON.stringify(this.chat);
    this.store=this.store.catch(()=>{}).then(async()=>{await mkdir(dir,{recursive:true});const target=path.join(dir,id+'.json'),temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,data);await rename(temp,target);});
    await this.store;await this.context.workspaceState.update('lastChat',id);
  }
  private async load(id:string){
    if(!/^[\w-]+$/.test(id))throw new Error('잘못된 대화 ID');
    const chat=JSON.parse(await readFile(path.join(this.directory(),'chats',id+'.json'),'utf8')) as Chat;
    if(!Array.isArray(chat.entries)||typeof chat.cwd!=='string')throw new Error('대화 파일을 읽을 수 없습니다.');
    this.chat=chat;this.connectedThread=undefined;this.attachments=[];this.status=chat.interrupted?'이전 작업이 중단되었습니다. 새 요청으로 이어가세요.':'대화 복원됨';
  }
  async newChat(){if(this.busy)throw new Error('진행 중인 작업을 중단한 뒤 새 대화를 시작하세요.');await this.save();this.chat=undefined;this.turn=undefined;this.connectedThread=undefined;this.attachments=[];this.status='새 대화';await this.context.workspaceState.update('lastChat',undefined);this.update();}
  private async history(){
    if(this.busy)throw new Error('진행 중인 작업을 중단한 뒤 대화를 변경하세요.');
    const dir=path.join(this.directory(),'chats');await mkdir(dir,{recursive:true});
    const chats:Chat[]=[];for(const file of await readdir(dir)){if(file.endsWith('.json'))try{chats.push(JSON.parse(await readFile(path.join(dir,file),'utf8')));}catch{}}
    const chosen=await vscode.window.showQuickPick(chats.sort((a,b)=>b.updated-a.updated).map(c=>({label:c.title,description:c.model,detail:c.cwd,id:c.id})),{title:'Ollama Sidebar 대화'});
    if(chosen){await this.save();await this.load(chosen.id);this.update();}
  }
  async attach(kind:'file'|'selection'){
    if(this.busy)throw new Error('작업이 끝난 뒤 첨부하세요.');
    const editor=vscode.window.activeTextEditor;if(!editor||editor.document.uri.scheme!=='file')throw new Error('첨부할 파일을 편집기에서 여세요.');
    if(kind==='selection'&&editor.selection.isEmpty)throw new Error('첨부할 코드를 선택하세요.');
    const text=editor.document.getText(kind==='selection'?editor.selection:undefined);
    const name=editor.document.uri.fsPath+(kind==='selection'?`:${editor.selection.start.line+1}-${editor.selection.end.line+1}`:'');
    attachmentPrompt('',[...this.attachments,{name,text}]);this.attachments.push({name,text});await this.reveal();this.update();
  }
  private async workingFolder(){
    const folders=vscode.workspace.workspaceFolders;if(!folders?.length)throw new Error('VS Code에서 작업할 폴더를 먼저 여세요.');
    if(folders.some(f=>f.uri.scheme!=='file')||vscode.env.remoteName)throw new Error('첫 버전은 로컬 Windows 폴더만 지원합니다.');
    if(folders.length===1)return folders[0].uri.fsPath;
    const chosen=await vscode.window.showWorkspaceFolderPick({placeHolder:'이 대화의 작업 폴더 선택'});if(!chosen)throw new Error('작업 폴더 선택이 취소되었습니다.');return chosen.uri.fsPath;
  }
  private async connect(){
    const settings=this.settings();
    const key=JSON.stringify(settings);if(this.rpc&&key===this.settingsKey)return;
    this.rpc?.removeAllListeners();this.rpc?.dispose();this.rpc=undefined;
    this.status='로컬 서버 연결 중';this.update();
    const state=path.join(this.directory(),'codex');const runtime=await prepareRuntime(settings,state,s=>{this.status=s;this.output.appendLine(s);this.update();});
    if(this.cancelled||this.disposed)throw new Error('연결이 취소되었습니다.');
    const rpc=new RpcClient();this.rpc=rpc;this.settingsKey=key;this.connectedThread=undefined;
    rpc.on('log',s=>this.output.appendLine(s));rpc.on('notification',m=>this.notification(m));rpc.on('request',m=>{void this.serverRequest(m).catch(e=>this.error(e));});
    rpc.on('disconnect',e=>{if(this.disposed)return;this.rpc=undefined;this.connectedThread=undefined;this.busy=false;this.turn=undefined;this.approvals.clear();if(this.chat)this.chat.interrupted=true;this.error(e);});
    rpc.start(runtime.binary,['app-server','--listen','stdio://'],this.chat!.cwd,runtime.env);
    await rpc.request('initialize',{clientInfo:{name:'self_agent',title:'Ollama Sidebar',version:this.context.extension.packageJSON.version},capabilities:{experimentalApi:false}});rpc.notify('initialized');
  }
  private async send(text:string){
    if(this.busy||this.choosingModel)return;if(!vscode.workspace.isTrusted)throw new Error('신뢰하는 작업 폴더에서 실행하세요.');
    const model=this.settings().model;
    if(this.chat&&this.chat.model!==model)throw new Error('모델이 변경되었습니다. 새 대화를 시작하세요.');
    if(!this.chat)this.chat={id:randomUUID(),title:text.slice(0,55),cwd:await this.workingFolder(),model,entries:[],updated:Date.now()};
    const dirty=vscode.workspace.textDocuments.filter(d=>d.isDirty&&d.uri.scheme==='file'&&this.inside(d.uri.fsPath));
    if(dirty.length){const choice=await vscode.window.showWarningMessage('저장되지 않은 파일이 있습니다. 파일 작업 전에 저장할까요?',{modal:true},'저장 후 진행');if(choice!=='저장 후 진행')return;for(const d of dirty)if(!await d.save())throw new Error('파일 저장이 취소되었습니다.');}
    const prompt=attachmentPrompt(text,this.attachments);this.cancelled=false;this.busy=true;this.started=Date.now();this.status='연결 중';this.update();
    try{
      await this.connect();
      if(this.cancelled)throw new Error('작업이 취소되었습니다.');
      if(!this.chat.threadId){
        const params:ThreadStartParams={model,modelProvider:'self_agent_ollama',cwd:this.chat.cwd,approvalPolicy:'on-request',sandbox:'workspace-write'};
        const r=await this.rpc!.request('thread/start',params);this.chat.threadId=r.thread.id;this.connectedThread=r.thread.id;
      }else if(this.connectedThread!==this.chat.threadId){await this.rpc!.request('thread/resume',{threadId:this.chat.threadId});this.connectedThread=this.chat.threadId;}
      if(this.cancelled)throw new Error('작업이 취소되었습니다.');
      this.chat.entries.push({id:randomUUID(),kind:'user',text:text+this.attachments.map(a=>'\n📎 '+a.name).join('')});this.attachments=[];this.chat.interrupted=true;await this.save();this.view?.webview.postMessage({type:'sent'});
      const params:TurnStartParams={threadId:this.chat.threadId!,input:[{type:'text',text:prompt,text_elements:[]}],effort:'none',summary:'none'};
      this.status='응답 대기 / 생성 중';this.update();const result=await this.rpc!.request('turn/start',params);if(this.busy)this.turn=result.turn.id;
      if(this.cancelled&&this.busy)await this.stop();
    }catch(e){this.busy=false;this.turn=undefined;this.error(e);}this.update();
  }
  private notification(m:RpcMessage){
    const p=m.params||{};if(!this.chat||p.threadId&&p.threadId!==this.chat.threadId)return;
    if(m.method==='turn/started'){this.turn=p.turn.id;this.busy=true;}
    if(m.method==='serverRequest/resolved'){this.approvals.delete(String(p.requestId));}
    applyEvent(this.chat,m.method!,p);
    if(m.method==='turn/completed'){this.busy=false;this.turn=undefined;this.approvals.clear();this.chat.interrupted=p.turn.status!=='completed';this.status=p.turn.status==='completed'?'완료':p.turn.status==='interrupted'?'중단됨':'작업 실패';if(p.turn.error)this.error(p.turn.error.message);}
    this.update();
  }
  private async serverRequest(m:RpcMessage){
    if(!this.rpc||m.id===undefined)return;
    if(m.params?.threadId!==this.chat?.threadId){this.rpc.reject(m.id,'Inactive thread');return;}
    if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval'].includes(m.method!)){this.approvals.set(String(m.id),m);this.status='사용자 승인 대기';this.update();return;}
    if(m.method==='item/tool/requestUserInput'){
      const answers:Record<string,{answers:string[]}>={};for(const q of m.params.questions){const value=await vscode.window.showInputBox({title:q.header,prompt:q.question+(q.options?' ('+q.options.map((o:any)=>o.label).join(', ')+')':''),password:q.isSecret});answers[q.id]={answers:value===undefined?[]:[value]};}this.rpc.respond(m.id,{answers});return;
    }
    this.rpc.reject(m.id,'This request is not supported by Ollama Sidebar 0.1.0');
  }
  private approve(key:string,decision:'accept'|'decline'){
    const r=this.approvals.get(key);if(!r||!this.rpc)return;
    if(r.method==='item/permissions/requestApproval')this.rpc.respond(r.id!,{permissions:decision==='accept'?Object.fromEntries(Object.entries(r.params.permissions).filter(([,v])=>v!==null)):{},scope:'turn'});
    else this.rpc.respond(r.id!,{decision});this.approvals.delete(key);this.status='응답 대기 / 생성 중';this.update();
  }
  private async stop(){
    if(!this.busy)return;if(!this.turn||!this.chat?.threadId){this.cancelled=true;this.status='연결 취소 중';this.update();return;}
    for(const key of [...this.approvals.keys()])this.approve(key,'decline');await this.rpc?.request('turn/interrupt',{threadId:this.chat.threadId,turnId:this.turn});this.status='중단 요청 중';this.update();
  }
  private inside(file:string){if(!this.chat)return false;const rel=path.relative(this.chat.cwd,path.resolve(file));return rel===''||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
  private async openFile(file:string,diff=false){
    if(!this.chat?.entries.some(e=>e.files?.includes(file))||!this.inside(file))throw new Error('이 대화의 작업 폴더에 있는 변경 파일만 열 수 있습니다.');
    if(diff){await vscode.commands.executeCommand('git.openChange',vscode.Uri.file(file));return;}
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  }
  dispose(){this.disposed=true;if(this.persistTimer)clearTimeout(this.persistTimer);void this.save();this.rpc?.dispose();this.output.dispose();}
}

export function activate(context:vscode.ExtensionContext){
  const provider=new ChatProvider(context);context.subscriptions.push(provider,vscode.window.registerWebviewViewProvider('selfAgent.chat',provider,{webviewOptions:{retainContextWhenHidden:true}}));
  const command=(name:string,fn:()=>Promise<void>)=>context.subscriptions.push(vscode.commands.registerCommand(name,()=>fn().catch(e=>vscode.window.showErrorMessage(String(e)))));
  command('selfAgent.open',()=>provider.reveal());command('selfAgent.newChat',async()=>{await provider.newChat();await provider.reveal();});command('selfAgent.attachSelection',()=>provider.attach('selection'));
  return {provider};
}
