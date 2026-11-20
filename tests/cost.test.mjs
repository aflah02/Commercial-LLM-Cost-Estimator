import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, validate, volume, ratesFor, estimate, normalizeOpenRouter, exportCSV, spreadsheetFormula } from '../public/assets/engine.mjs';
import vm from 'node:vm';
const {models}=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url)));
const model=id=>models.find(m=>m.id===id);
const config=extra=>({...structuredClone(DEFAULTS),...extra});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('100K × 100K/5K reproduces the quoted GPT matrix',()=>{
  for(const [id,total] of [['gpt-6.2-astra',100000],['gpt-6.2-sol',25000],['gpt-6.1-sol',25000],['gpt-6.1-terra',12500],['gpt-6-astra',125000],['gpt-6-sol',25000],['gpt-6-luna',1250],['gpt-5.6-sol',50000],['gpt-5.6-terra',26000],['gpt-5.6-luna',2600]]) {
    const r=estimate(model('openai:'+id),config());assert.equal(r.eligible,true);close(r.total,total);
  }
});
test('calling rate respects seconds/minutes/hours/days, active hours, and retries',()=>{
  close(volume(config({mode:'rate',rate:2,rateUnit:'second',hours:8,days:20,retries:10})).attempts,1267200);
  close(volume(config({mode:'rate',rate:10,rateUnit:'minute',hours:24,days:30})).base,432000);
  close(volume(config({mode:'rate',rate:2,rateUnit:'hour',hours:8,days:20})).base,320);
  close(volume(config({mode:'rate',rate:5,rateUnit:'day',hours:8,days:20})).base,100);
});
test('cached tokens partition input and write tokens replace normal input',()=>{
  const r=estimate(model('openai:gpt-6.1-sol'),config({cache:50,cacheWrite:10}));
  close(r.input,8000);close(r.cacheRead,500);close(r.cacheWrite,2500);close(r.output,5000);close(r.total,16000);
  close(estimate(model('openai:gpt-6.1-sol'),config({cache:100})).total,6000);
  assert.ok(validate(config({cache:90,cacheWrite:11})).length);
});
test('full-request context tiers switch strictly above the threshold, including tool results',()=>{
  const m=model('openai:gpt-6.1-sol');
  assert.equal(ratesFor(m,config(),272000).input,2);
  assert.equal(ratesFor(m,config(),272001).input,4);
  const haiku=model('anthropic:claude-haiku-5-5');
  assert.equal(estimate(haiku,config()).rates.output,.5);
  assert.equal(estimate(haiku,config({toolTokens:1})).rates.output,2.5);
  assert.equal(estimate(haiku,config({cache:100,toolTokens:1})).rates.cached,.05);
});
test('output includes thinking once; visible output adds reasoning; effort has no multiplier',()=>{
  const m=model('openai:gpt-6.1-sol');
  close(estimate(m,config({outputMode:'total',reasoning:20000})).total,25000);
  close(estimate(m,config({outputMode:'visible',reasoning:20000})).total,45000);
  close(estimate(m,config({effort:'max'})).total,25000);
  assert.equal(estimate(m,config({effort:'none'})).eligible,false);
});
test('batch affects tokens but native tool/batch combinations are rejected',()=>{
  close(estimate(model('openai:gpt-6.1-sol'),config({tier:'batch'})).total,12500);
  assert.equal(estimate(model('openai:gpt-6.1-sol'),config({tier:'batch',search:1})).eligible,false);
  assert.equal(estimate(model('openrouter:openai/gpt-6.2-sol'),config({tier:'batch'})).eligible,false);
});
test('tool calls, result tokens, storage, custom fees and remaining allowance reconcile',()=>{
  const r=estimate(model('openai:gpt-6.1-sol'),config({search:2,fileSearch:1,code:.1,storage:3,toolTokens:1000,customCalls:.5,customRate:7,freeSearch:1000}));
  close(r.input,20200);close(r.output,5000);
  close(r.toolCost,1990+250+300+6+350);close(r.total,28096);
  close(r.total,r.input+r.cacheRead+r.cacheWrite+r.output+r.reasoning+r.tools.reduce((a,b)=>a+b.cost,0));
});
test('Claude runtime is free with current search, and charged per hour without it',()=>{
  const m=model('anthropic:claude-sonnet-5-5');
  close(estimate(m,config({code:1})).toolCost,5000);
  close(estimate(m,config({code:1,search:1})).toolCost,1000);
});
test('known future Google price and cache-storage changes apply',()=>{
  const m=model('google:gemini-4-carbon');close(estimate(m,config()).total,25000);
  close(estimate(m,config({pricingDate:'2026-12-01'})).total,50000);
  const flash=model('google:gemini-3.8-flash');
  close(estimate(flash,config({cacheTokenHours:10})).tools[0].cost,5);
  close(estimate(flash,config({cacheTokenHours:10,pricingDate:'2027-01-01'})).tools[0].cost,10);
  assert.equal(estimate(model('openai:gpt-5.6-sol'),config({pricingDate:'2026-12-01'})).eligible,false);
});
test('invalid workloads and context limits cannot produce eligible estimates',()=>{
  for (const value of [-1,NaN,Infinity]) assert.ok(validate(config({input:value})).length);
  assert.ok(validate(config({hours:25})).length);
  assert.equal(estimate(model('mistral:codestral-2508'),config({input:130000,output:5000})).eligible,false);
  assert.equal(estimate(model('google:gemini-4-neon'),config({output:65537})).eligible,false);
});
test('OpenRouter converts prices, preserves zero and optional fields, and rejects unknown rules',()=>{
  const m=normalizeOpenRouter({id:'test/model',name:'Test',context_length:1000000,pricing:{prompt:'0.000002',completion:'0',request:'0.001',input_cache_read:'0',overrides:[{min_prompt_tokens:200000,prompt:'0.000004'}]},reasoning:{supported_efforts:['high']}});
  assert.equal(m.input,2);assert.equal(m.output,0);assert.equal(m.cached,0);assert.equal(m.requestFee,.001);assert.equal(m.tools.search,undefined);
  assert.equal(estimate(m,config({search:1})).eligible,false);
  assert.equal(normalizeOpenRouter({id:'bad',name:'Bad',pricing:{prompt:'-1',completion:'0'}}),null);
  const timed=normalizeOpenRouter({id:'timed',name:'Timed',pricing:{prompt:'.000001',completion:'.000002',overrides:[{start_hour:8,prompt:'.000003'}]}});
  assert.equal(estimate(timed,config()).eligible,false);
});
test('OpenRouter plugin search can be priced without native search support',()=>{
  const m=model('openrouter:mistralai/mistral-large-4-0');
  assert.equal(estimate(m,config({search:1})).eligible,false);
  const r=estimate(m,config({search:1,orSearch:'parallel-fast'}));assert.equal(r.eligible,true);close(r.toolCost,100);
});
test('CSV quotes commas, and neutralizes user-supplied spreadsheet formulas',()=>{
  const r=estimate({...model('openai:gpt-6.1-sol'),name:'=HYPERLINK("bad","x")'},config());
  const csv=exportCSV([r]);assert.ok(csv.includes('"\'=HYPERLINK(""bad"",""x"")"'));assert.ok(csv.includes('Total USD'));
});
test('all catalog IDs are unique and source URLs use HTTPS',()=>{
  assert.equal(new Set(models.map(m=>m.id)).size,models.length);
  for(const m of models){assert.ok(m.source.startsWith('https://'));assert.ok(m.input>=0);assert.ok(m.output>=0);}
});
test('copied spreadsheet formulas equal the billing engine across tools, caches, and tiers',()=>{
  for (const s of [config(),config({cache:50,cacheWrite:10,search:2,storage:3,code:.1,retries:5,customCalls:.5,customRate:7}),config({tier:'batch',cache:30,cacheWrite:10}),config({outputMode:'visible',reasoning:5000,mode:'rate',rate:.3,rateUnit:'second'})]) {
    const r=estimate(model('openai:gpt-6.1-sol'),s);
    const formula=spreadsheetFormula(r,s);assert.ok(formula.startsWith('='));
    close(vm.runInNewContext(formula.slice(1)),r.total);
  }
});
test('standalone JavaScript export works without imports or surrounding app state',()=>{
  const m=model('openai:gpt-6.1-sol'),s=config({search:1,outputMode:'visible',reasoning:5000});
  const code=[validate,volume,ratesFor,estimate].map(fn=>fn.toString()).join('\n')+`\nestimate(${JSON.stringify(m)},${JSON.stringify(s)}).total`;
  close(vm.runInNewContext(code),31000);
});
