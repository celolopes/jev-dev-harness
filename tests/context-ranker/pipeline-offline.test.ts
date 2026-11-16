import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const mock=vi.hoisted(()=>({calls:[] as any[],mode:'ok',model:'jev-1.13.0'}));
vi.mock('../../src/shared/typesafe-client.js',async importOriginal=>{
 const actual=await importOriginal<any>();
 return {...actual,SafeJevClient:class {
  provider='typesafe';decisionMode='jev';timeoutMs=5000;isConfigured=true;
  get modelName(){return mock.model;} get cacheIdentity(){return `typesafe:${mock.model}:offline-test`;}
  getReason(){return 'DISABLED_BY_USER';}
  async systemOne(state:any,questions:any,options:any){
   mock.calls.push({state,questions,options});
   if(mock.mode==='failure')return {ok:false,reason:'TIMEOUT'};
   const relevant=/orders|money/.test(state.file.path);
   const role=state.file.path.includes('test')?'test':'implementation';
   return {ok:true,inputTokens:100,outputTokens:10,latencyMs:1,decisionMode:'jev',result:{model:mock.model,answers:{
    relevant_to_task:{type:'noul',noul:mock.mode==='low'?0.2:relevant?0.95:0.01},
    relevance:{type:'score',score:mock.mode==='invalid'?99:mock.mode==='low'?4:relevant?4:0,confidence:0.95},
    role:{type:'choice',choice:relevant?role:'unrelated',confidence:0.95}
   }}};
  }
 }};
});
import {rankContext} from '../../src/context-ranker/index.js';
let repo:string;
function write(name:string,text:string){const p=path.join(repo,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const opts=()=>({repoPath:repo,task:'Fix orders total and money rounding; include dependent utilities and orders tests',useCache:false,top:10,threshold:0.15,decisionConcurrency:1,decisionBudgetMs:5000});
const paths=(r:any)=>r.selected.map((x:any)=>x.path.replace(/\\/g,'/'));
beforeEach(()=>{
 repo=fs.mkdtempSync(path.join(os.tmpdir(),'jev-real-pipeline-'));
 mock.calls.length=0;mock.mode='ok';mock.model='jev-1.13.0';
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN_IN_TEST');}));
 write('src/orders.ts',"import {money} from './money'; export const ordersTotal=(xs)=>money(xs.reduce((n,x)=>n+x.price,0));");
 write('src/money.ts','export const money=(n)=>Math.round(n*100)/100;');
 write('tests/orders.test.ts',"test('orders total money rounding',()=>ordersTotal([{price:0.1}]));");
 write('src/avatar.ts','export const avatarColor=()=>"green";');
 write('.env','SYNTHETIC_ONLY=do-not-send');write('secrets.key','SYNTHETIC_ONLY');
 write('node_modules/orders/index.ts','orders money ignored dependency code');write('dist/orders.js','orders generated');
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();const p=path.resolve(repo);if(!p.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(p).startsWith('jev-real-pipeline-'))throw Error('UNSAFE_CLEANUP');fs.rmSync(p,{recursive:true,force:true});});
describe('Real rankContext stages A-D with offline semantic boundary',()=>{
 it('selects implementation, source dependency and test, excludes secrets and generated/vendor files before transport',async()=>{
  const r=await rankContext(opts());expect(paths(r)).toEqual(expect.arrayContaining(['src/orders.ts','src/money.ts','tests/orders.test.ts']));
  expect(paths(r)).not.toContain('src/avatar.ts');expect(r.fallbackUsed).toBe(false);
  const sent=mock.calls.map(x=>x.state.file.path.replace(/\\/g,'/'));for(const excluded of ['.env','secrets.key','node_modules/orders/index.ts','dist/orders.js'])expect(sent).not.toContain(excluded);
  expect(JSON.stringify(mock.calls)).not.toContain('SYNTHETIC_ONLY');expect(r.metrics.newModelCalls).toBe(mock.calls.length);
 });
 it('uses real Stage C contract, not previous direct-API benchmark questions',async()=>{
  await rankContext(opts());for(const call of mock.calls){expect(Object.keys(call.questions).sort()).toEqual(['relevance','relevant_to_task','role']);expect(call.state).toHaveProperty('file.snippet');expect(call.state.candidates).toBeUndefined();expect(call.state.expected).toBeUndefined();expect(call.state.file.snippet.length).toBeLessThanOrEqual(1200);}
 });
 it('disabled mode performs deterministic fallback and no semantic call',async()=>{
  const r=await rankContext({...opts(),useJev:false});expect(mock.calls.length).toBe(0);expect(r.fallbackUsed).toBe(true);expect(r.metrics.fallbackReason).toBe('DISABLED_BY_USER');expect(paths(r)).toContain('tests/orders.test.ts');expect(r.selected.every(x=>x.source==='deterministic_fallback')).toBe(true);
 });
 it('timeout response falls back without dropping all relevant files',async()=>{
  mock.mode='failure';const r=await rankContext(opts());expect(r.fallbackUsed).toBe(true);expect(r.metrics.fallbackReason).toContain('TIMEOUT');expect(paths(r)).toContain('src/orders.ts');expect(r.selected.every(x=>x.source==='deterministic_fallback')).toBe(true);
 });
 it('invalid semantic score falls back rather than accepting malformed evidence',async()=>{
  mock.mode='invalid';const r=await rankContext(opts());expect(r.fallbackUsed).toBe(true);expect(r.metrics.fallbackReason).toContain('INVALID_RANKING_RESPONSE');expect(r.selected.every(x=>x.source==='deterministic_fallback')).toBe(true);
 });
 it('unchanged fixed-model run reuses cache without new token charges',async()=>{
  const o={...opts(),useCache:true};const first=await rankContext(o);mock.calls.length=0;const second=await rankContext(o);expect(mock.calls).toHaveLength(0);expect(paths(second)).toEqual(paths(first));expect(second.metrics.newModelCalls).toBe(0);expect(second.metrics.tokensSent).toBe(0);expect(second.metrics.tokensReceived).toBe(0);expect(second.metrics.cacheHits).toBeGreaterThan(0);
 });
 it('task and model identities isolate cached decisions',async()=>{
  const o={...opts(),useCache:true};await rankContext(o);mock.calls.length=0;await rankContext({...o,task:o.task+' and document behavior'});expect(mock.calls.length).toBeGreaterThan(0);mock.calls.length=0;mock.model='jev-1.14.0';await rankContext(o);expect(mock.calls.length).toBeGreaterThan(0);
 });
 it('changed snippet invalidates affected cache entry',async()=>{
  const o={...opts(),useCache:true};await rankContext(o);mock.calls.length=0;write('src/money.ts','export const money=(n)=>Number(n.toFixed(2));');await rankContext(o);expect(mock.calls.map(x=>x.state.file.path.replace(/\\/g,'/'))).toEqual(['src/money.ts']);
 });
 it('real composite ranking can retain low Noul when role/score/heuristic support relevance',async()=>{
  mock.mode='low';const r=await rankContext(opts());expect(paths(r)).toContain('src/orders.ts');expect(r.selected.find(x=>x.path.replace(/\\/g,'/')==='src/orders.ts')!.score).toBeGreaterThan(0.15);
 });
 it('threshold and top are enforced on final score, not direct Noul0.5',async()=>{
  const r=await rankContext({...opts(),top:1});expect(r.selected).toHaveLength(1);const high=await rankContext({...opts(),threshold:1});expect(high.selected).toHaveLength(0);
 });
 it('Stage B shortlist limits semantic visibility; missing candidates cannot be recovered by model',async()=>{
  const r=await rankContext({...opts(),stageBCandidateLimit:1});expect(mock.calls).toHaveLength(1);expect(r.metrics.evaluatedCandidates).toBe(1);expect(r.selected.length).toBeLessThanOrEqual(1);
 });
});
