import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, attachmentPrompt, Chat } from '../src/state';
import { localEndpoint } from '../src/runtime';
const chat=():Chat=>({id:'one',cwd:'C:/test',title:'test',model:'gemma4:e4b',threadId:'t1',updated:0,entries:[]});
test('streaming is finalized without duplicate text and unrelated threads are ignored',()=>{
 const c=chat();applyEvent(c,'item/agentMessage/delta',{threadId:'t1',itemId:'a',delta:'안녕'});applyEvent(c,'item/agentMessage/delta',{threadId:'t1',itemId:'a',delta:'하세요'});applyEvent(c,'item/agentMessage/delta',{threadId:'other',itemId:'b',delta:'bad'});applyEvent(c,'item/completed',{threadId:'t1',item:{id:'a',type:'agentMessage',text:'안녕하세요'}});assert.equal(c.entries.length,1);assert.equal(c.entries[0].text,'안녕하세요');
});
test('commands expose failures and output, file changes carry paths',()=>{
 const c=chat();applyEvent(c,'item/started',{item:{id:'c',type:'commandExecution',command:'Get-Content x',status:'inProgress'}});applyEvent(c,'item/completed',{item:{id:'c',type:'commandExecution',command:'Get-Content x',aggregatedOutput:'not found',status:'failed'}});assert.equal(c.entries[0].status,'failed');assert.match(c.entries[0].text,/not found/);applyEvent(c,'item/completed',{item:{id:'f',type:'fileChange',status:'completed',changes:[{path:'C:/test/a',diff:'+new'}]}});assert.deepEqual(c.entries[1].files,['C:/test/a']);
});
test('attachments use UTF-8 byte limits including Korean',()=>{assert.throws(()=>attachmentPrompt('x',[{name:'a',text:'한'.repeat(11000)}]),/32KiB/);assert.match(attachmentPrompt('fix',[{name:'a.ts:1-2',text:'code'}]),/a.ts:1-2/);});
test('only loopback Ollama endpoints are accepted',()=>{assert.equal(localEndpoint('http://127.0.0.1:11435'),'http://127.0.0.1:11435');for(const u of ['https://example.com','http://example.com','http://user:pass@localhost','http://localhost/foo'])assert.throws(()=>localEndpoint(u));});
