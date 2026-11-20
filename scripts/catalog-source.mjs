// USD / million tokens. Source URLs and verification dates travel with every route.
import { writeFile } from 'node:fs/promises';
import { normalizeOpenRouter } from '../public/assets/engine.mjs';
const checked = '2026-11-20';
const urls = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  google: 'https://aistudio.google.com/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  mistral: 'https://docs.mistral.ai/inference/pricing',
  openrouter: 'https://openrouter.ai/api/v1/models'
};
const fee = (name, rate, unit, source, note = '') => ({ name, rate, unit, source, note });
const tools = {
  openai: {
    search: fee('Web search', .01, 'search calls', urls.openai, 'Search-result tokens are extra input; enter them under tool-result tokens.'),
    fileSearch: fee('File search', .0025, 'retrieval calls', urls.openai),
    code: fee('Code Interpreter / hosted shell', .03, '1 GB · 20-minute container sessions', urls.openai),
    storage: { rate: .10, free: 1, source: urls.openai }
  },
  google: {
    search: fee('Search grounding', .014, 'individual queries', urls.google, 'Queries, not model requests. A 5,000-query monthly allowance is shared; enter only your remaining allowance manually.'),
    code: fee('Code execution', 0, 'executions', urls.google, 'No runtime fee; code and result tokens must be included in your token budget.')
  },
  anthropic: {
    search: fee('Web search', .01, 'search calls', urls.anthropic, 'Search results are billed as input tokens; web fetch has no separate fee.'),
    code: { ...fee('Code execution', .05, 'container-hours', urls.anthropic, 'At least 5 minutes per execution session. Excludes 1,550 organization-wide free hours/month. Free with the current web-search/fetch tool included.'), freeWithSearch: true }
  },
  mistral: {}
};
const models = [];
const add = (provider, apiId, name, input, output, extra = {}) => models.push({
  id: `${provider}:${apiId}`, apiId, provider, name, input, output, checked,
  source: urls[provider], batch: true, batchFactor: .5,
  context: 1050000, maxOutput: 128000, tools: tools[provider], ...extra
});
const allEfforts = ['none','low','medium','high','xhigh','max'];
for (const [id,name,input,output,cached,none] of [
  ['gpt-6.2-astra','GPT-6.2 Astra',8,40,.4,false], ['gpt-6.2-sol','GPT-6.2 Sol',2,10,.1,false],
  ['gpt-6.1-sol','GPT-6.1 Sol',2,10,.1,false], ['gpt-6.1-terra','GPT-6.1 Terra',1,5,.05,true],
  ['gpt-6-astra','GPT-6 Astra',10,50,1,false], ['gpt-6-sol','GPT-6 Sol',2,10,.2,true],
  ['gpt-6-luna','GPT-6 Luna',.1,.5,.01,true], ['gpt-5.6-sol','GPT-5.6 Sol',4,20,.4,true],
  ['gpt-5.6-terra','GPT-5.6 Terra',2,12,.2,true], ['gpt-5.6-luna','GPT-5.6 Luna',.2,1.2,.02,true]
]) add('openai', id, name, input, output, {
  cached, cacheWrite: input*1.25, cacheWriteLong: input*2.5,
  efforts: none ? allEfforts : allEfforts.slice(1),
  contextPrices: [{ threshold: 272000, rates: { input: input*2, output: output*1.5, cached: cached*2, cacheWrite: input*2.5, cacheWriteLong: input*5 } }],
  ...(id === 'gpt-5.6-sol' ? { promoEnd:'2026-11-30', note:'Promotional API pricing through November 30, 2026. Later pricing has not been assumed.' } : {})
});
for (const [id,name,input,output,cached] of [
  ['gpt-6.2-astra-law','GPT-6.2 Astra Law',8,40,.4], ['gpt-6-astra-law','GPT-6 Astra Law',10,50,1],
  ['gpt-6-rosalind','GPT-6 Rosalind',10,50,1], ['gpt-6-cyber','GPT-6 Cyber',20,100,2], ['gpt-5.6-cyber','GPT-5.6 Cyber',12.5,75,1.25]
]) add('openai', id, name, input, output, { cached, batch:false, efforts:[], context: id === 'gpt-5.6-cyber' ? 400000 : 1050000,
  maxInput: id === 'gpt-5.6-cyber' ? 272000 : undefined,
  contextPrices:[{ threshold:272000, rates:{input:input*2,output:output*1.5,cached:cached*2} }],
  note:'Specialized access required. Effort support is not separately verified; listed rates are API rates.' });
for (const [id,name,input,output,cached] of [
  ['gemini-4-carbon','Gemini 4 Carbon',2,10,.1], ['gemini-4-argon','Gemini 4 Argon',2,10,.1],
  ['gemini-4-neon','Gemini 4 Neon',3,15,.15], ['gemini-4-hydrogen','Gemini 4 Hydrogen',1.5,7.5,.075],
  ['gemini-3.8-flash','Gemini 3.8 Flash',.75,3.75,.075], ['gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite',.30,2.5,.03]
]) add('google', id, name, input, output, { cached, context:1048576, maxOutput:65536, efforts:[],
  cacheStorage: id === 'gemini-3.8-flash' ? .5 : id === 'gemini-3.5-flash-lite' ? 1 : null,
  priceChanges: ['gemini-4-carbon','gemini-4-argon'].includes(id) ? [{ date:'2026-12-01', input:4,output:20,cached:.2 }] : id === 'gemini-3.8-flash' ? [{ date:'2027-01-01',input:1.5,output:7.5,cached:.15,cacheStorage:1 }] : [],
  note: id.startsWith('gemini-4') ? 'Implicit cache only. Synchronous output limit; long-decode pricing is not modeled. Thinking settings use a different API vocabulary.' : 'Explicit cache storage is additional. Thinking tokens are billed as output.' });
for (const [id,name,input,output,cached] of [
  ['claude-fable-5-2','Claude Fable 5.2',8,40,.2], ['claude-opus-5-5','Claude Opus 5.5',4,20,.2],
  ['claude-sonnet-5-5','Claude Sonnet 5.5',2,10,.1], ['claude-haiku-5-5','Claude Haiku 5.5',.1,.5,.01],
  ['claude-fable-5-1','Claude Fable 5.1',10,50,.25], ['claude-opus-5','Claude Opus 5',5,25,.5], ['claude-sonnet-4-6','Claude Sonnet 4.6',3,15,.3]
]) add('anthropic',id,name,input,output,{ cached,cacheWrite:input*1.25,cacheWriteLong:input*2,context:1000000,
  efforts: id === 'claude-sonnet-4-6' ? ['low','medium','high','max'] : ['low','medium','high','xhigh','max'],
  contextPrices: id === 'claude-haiku-5-5' ? [{threshold:100000,rates:{input:.5,output:2.5,cached:.05,cacheWrite:.625,cacheWriteLong:1}}] : [],
  note:'Cache-write retention is 5 minutes (short) or 1 hour (long). Thinking is included in billed output.' });
for (const [id,name,input,output,context,efforts] of [
  ['mistral-large-4-0','Mistral Large 4',.7,2.1,1048576,['low','medium','high']],
  ['mistral-small-2603','Mistral Small 4',.15,.6,262144,['none','high']],
  ['ministral-14b-2512','Ministral 3 · 14B',.2,.2,262144,[]], ['ministral-8b-2512','Ministral 3 · 8B',.15,.15,262144,[]],
  ['ministral-3b-2512','Ministral 3 · 3B',.1,.1,262144,[]], ['codestral-2508','Codestral',.3,.9,131072,[]]
]) add('mistral',id,name,input,output,{cached:input*.1,context,maxOutput:null,efforts,
  note:'Native tool fees are not freshly verified. Use the custom-tool charge for Conversations/Agents tools; do not assume they are free. Max output limit is not verified.'});
const openrouterSeeds = [
  ['openai/gpt-6.2-astra','OpenAI: GPT-6.2 Astra',1050000,128000,.000008,.00004,.0000004,.01,['low','medium','high','xhigh','max'],.00001],
  ['openai/gpt-6.2-sol','OpenAI: GPT-6.2 Sol',1050000,128000,.000002,.00001,.0000001,.01,['low','medium','high','xhigh','max'],.0000025],
  ['anthropic/claude-fable-5.2','Anthropic: Claude Fable 5.2',1000000,128000,.000008,.00004,.0000002,.01,['low','medium','high','xhigh','max'],.00001],
  ['anthropic/claude-sonnet-5.5','Anthropic: Claude Sonnet 5.5',1000000,128000,.000002,.00001,.0000001,.01,['low','medium','high','xhigh','max'],.0000025],
  ['google/gemini-4-neon','Google: Gemini 4 Neon',1048576,943718,.000003,.000015,.00000015,.014,['low','medium','high','xhigh']],
  ['mistralai/mistral-large-4-0','Mistral: Mistral Large 4',1048576,262144,.0000007,.0000021,.00000007,undefined,['none','high']],
  ['deepseek/deepseek-v4.1-flash','DeepSeek: DeepSeek V4.1 Flash',1048576,943718,.0000003,.0000012,.000000006,undefined,['none','low','high','max']],
  ['anthropic/claude-fable-5.1','Anthropic: Claude Fable 5.1',1000000,128000,.00001,.00005,.00000025,.01,['low','medium','high','xhigh','max'],.0000125]
];
for (const [id,name,context_length,max_completion_tokens,prompt,completion,input_cache_read,web_search,supported_efforts,input_cache_write] of openrouterSeeds) {
  const pricing = { prompt,completion,input_cache_read,web_search,input_cache_write };
  if (id === 'openai/gpt-6.2-astra') pricing.overrides=[{min_prompt_tokens:272000,prompt:.000016,completion:.00006,input_cache_read:.0000008,input_cache_write:.00002}];
  if (id === 'openai/gpt-6.2-sol') pricing.overrides=[{min_prompt_tokens:272000,prompt:.000004,completion:.000015,input_cache_read:.0000002,input_cache_write:.000005}];
  if (id === 'anthropic/claude-fable-5.2') pricing.input_cache_write_1h=.000016;
  if (id === 'anthropic/claude-sonnet-5.5') pricing.input_cache_write_1h=.000004;
  if (id === 'anthropic/claude-fable-5.1') pricing.input_cache_write_1h=.00002;
  if (id === 'google/gemini-4-neon') { pricing.internal_reasoning=.000015;pricing.input_cache_write=.0000000833333333333333; }
  models.push(normalizeOpenRouter({id,name,context_length,max_completion_tokens,pricing,supported_efforts},checked));
}
await writeFile(new URL('../public/data/catalog.json',import.meta.url), JSON.stringify({checked, currency:'USD', sources:urls, models},null,2)+'\n');
console.log(`Wrote ${models.length} source-backed model routes.`);
