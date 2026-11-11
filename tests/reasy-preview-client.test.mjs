import assert from 'node:assert/strict';
import test from 'node:test';
import {ReasyPreviewClient,localPreviewOrigin,previewView} from '../lib/reasy-preview-client.js';
const health={protocol:'colorsync.reasy-preview',version:1,rendererReady:true,materials:[{key:'cloth'}],capabilities:{pick:true},resourceVersion:1};
const snapshot={revision:4,materials:[{id:'id:cloth'}]};
const png='data:image/png;base64,aGVsbG8=';
const frame={rendered:true,frameId:1,revision:4,width:640,height:640,image:png};
const response=data=>({ok:true,json:async()=>data});
async function ready(handler=async()=>response(frame)){const calls=[];const client=new ReasyPreviewClient(async(url,options)=>{calls.push({url,options});return url.endsWith('/health')?response(health):handler(url,options);});await client.connect('http://127.0.0.1:8765','fixture-token');return{client,calls};}
test('preview URL refuses external destinations, credentials, redirects and arbitrary paths',()=>{
 for(const url of ['https://example.com','http://127.0.0.1.evil.test','http://user:pass@127.0.0.1:8765','http://127.0.0.1:8765/files','http://127.0.0.1:8765?token=x','file:///tmp/test'])assert.throws(()=>localPreviewOrigin(url));
 assert.equal(localPreviewOrigin('http://127.0.0.1:8765/'),'http://127.0.0.1:8765');
});
test('camera rejects nonfinite, out-of-range and noninteger dimensions',()=>{
 for(const view of [{yaw:Infinity},{pitch:90},{distance:0},{width:2000},{height:640.5}])assert.throws(()=>previewView(view));
 assert.equal(previewView().distance,1.55);
});
test('connect authenticates explicitly, never sends cookies, and disconnect clears token',async()=>{
 const {client,calls}=await ready();assert.equal(calls[0].options.headers['X-ColorSync-Token'],'fixture-token');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');
 client.disconnect();assert.equal(client.token,null);assert.equal(client.connected,false);await assert.rejects(()=>client.render({snapshot}),/Connect/);
});
test('invalid/unready host clears ephemeral connection state',async()=>{
 for(const data of [{...health,version:2},{...health,rendererReady:false,reason:'No GPU'},{...health,materials:[{key:'x'},{key:'x'}]}]){
 const client=new ReasyPreviewClient(async()=>response(data));await assert.rejects(()=>client.connect('http://127.0.0.1:8765','fixture-token'));assert.equal(client.token,null);assert.equal(client.connected,false);}
});
test('render sends exact explicit bindings and preserves null resource version',async()=>{
 const {client,calls}=await ready();const input={...snapshot,resourceVersion:null};const output=await client.render({snapshot:input,bindings:{cloth:'id:cloth'}});
 assert.equal(output.frameId,1);const request=JSON.parse(calls.at(-1).options.body);assert.deepEqual(request.bindings,{cloth:'id:cloth'});assert.equal(request.snapshot.resourceVersion,null);
});
test('unbound isolation and foreign identities fail before transmission',async()=>{
 const {client,calls}=await ready();const count=calls.length;
 await assert.rejects(()=>client.render({snapshot,bindings:{missing:'id:cloth'}}));
 await assert.rejects(()=>client.render({snapshot,bindings:{cloth:'wrong'}}));
 await assert.rejects(()=>client.render({snapshot,isolate:true,selectedMaterialId:'id:cloth'}));assert.equal(calls.length,count);
});
test('invalid images, dimensions, unrendered and stale responses are rejected',async()=>{
 for(const bad of [{image:'https://external.test/p.png'},{image:'data:image/svg+xml;base64,PHN2Zz4='},{width:9999},{frameId:null},{rendered:false},{revision:3}]){
 const{client}=await ready(async()=>response({...frame,...bad}));await assert.rejects(()=>client.render({snapshot}));}
});
test('late frames after disconnect cannot replace state',async()=>{
 let release;const {client}=await ready(()=>new Promise(resolve=>{release=resolve;}));const pending=client.render({snapshot});client.disconnect();release(response(frame));await assert.rejects(()=>pending,/superseded/);
});
test('newer request wins even if an old fetch ignores cancellation',async()=>{
 const pending=[];const {client}=await ready(()=>new Promise(resolve=>pending.push(resolve)));
 const old=client.render({snapshot}),fresh=client.render({snapshot});pending[1](response({...frame,frameId:2}));assert.equal((await fresh).frameId,2);pending[0](response(frame));await assert.rejects(()=>old,/superseded/);
});
test('picking validates frame identity and uses only explicit local endpoint',async()=>{
 const {client,calls}=await ready(async()=>response({frameId:9,materialId:'id:cloth'}));const result=await client.pick(9,10,20);assert.equal(result.materialId,'id:cloth');assert.deepEqual(JSON.parse(calls.at(-1).options.body),{frameId:9,x:10,y:20});await assert.rejects(()=>client.pick(8,10,20),/older frame/);
});
