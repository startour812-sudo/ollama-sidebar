import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {once} from 'node:events';
import {RpcClient} from '../src/rpc';
function client(){const c=new RpcClient();c.start(process.execPath,[path.join(__dirname,'mock-rpc.cjs')],__dirname,process.env);return c;}
test('RPC correlates concurrent requests, errors and server events',async()=>{const c=client();try{const notification=once(c,'notification'),approval=once(c,'request');const results=await Promise.all([c.request('events',{n:1}),c.request('echo',{n:2})]);assert.deepEqual(results,[{echo:{n:1}},{echo:{n:2}}]);assert.equal((await notification)[0].method,'turn/started');assert.equal((await approval)[0].id,'approval');c.respond('approval',{decision:'decline'});await assert.rejects(c.request('fail',{}),/test failure/);}finally{c.dispose();}});
test('timeouts do not retransmit and process exit rejects pending work',async()=>{const c=client();try{await assert.rejects(c.request('timeout',{},50),/시간 초과/);await assert.rejects(c.request('crash',{}),/연결 종료/);}finally{c.dispose();}});
