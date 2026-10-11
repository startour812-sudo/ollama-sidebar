import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export type RpcMessage = {id?: number|string; method?: string; params?: any; result?: any; error?: {code?:number;message: string}};
export class RpcClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, {resolve:(v:any)=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout}>();
  start(executable:string, args:string[], cwd:string, env:NodeJS.ProcessEnv) {
    this.child = spawn(executable,args,{cwd,env,windowsHide:true,stdio:'pipe'});
    const lines = createInterface({input:this.child.stdout});
    lines.on('line',line=>{try {this.receive(JSON.parse(line));} catch(e) {this.emit('log',`Invalid RPC message: ${String(e)}`);}});
    this.child.stderr.on('data',data=>this.emit('log',String(data)));
    this.child.stdin.on('error',e=>this.fail(e));
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',code=>{lines.close();this.fail(new Error(`Codex 연결 종료 (${code})`));});
  }
  receive(message:RpcMessage) {
    if (message.method) {this.emit(message.id !== undefined ? 'request':'notification',message);return;}
    const p=this.pending.get(Number(message.id)); if(!p)return;
    this.pending.delete(Number(message.id));clearTimeout(p.timer);
    if(message.error)p.reject(new Error(message.error.message));else p.resolve(message.result);
  }
  private send(value:RpcMessage) {
    if(!this.child?.stdin.writable)throw new Error('Codex가 연결되지 않았습니다.');
    this.child.stdin.write(JSON.stringify(value)+'\n');
  }
  request<T=any>(method:string,params:unknown,timeout=60000):Promise<T> {
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 응답 시간 초과. 작업은 자동 재전송하지 않습니다.`));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try {this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  notify(method:string,params:unknown={}) {this.send({method,params});}
  respond(id:string|number,result:unknown) {this.send({id,result});}
  reject(id:string|number,message:string) {this.send({id,error:{code:-32601,message}});}
  private fail(error:Error) {for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.emit('disconnect',error);}
  dispose(){this.child?.stdin.end();this.child?.kill();this.child=undefined;this.fail(new Error('Codex 종료'));}
}
