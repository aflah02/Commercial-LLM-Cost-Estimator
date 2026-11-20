import { DEFAULTS, validate, volume, ratesFor, estimate, normalizeOpenRouter, exportCSV, spreadsheetFormula } from './engine.mjs';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : '#methodology'; } catch { return '#methodology'; } };
const money = (n, digits = 2) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
const compact = n => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
const num = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const per = n => money(n, n && n < .01 ? 6 : n && n < .1 ? 4 : 3);
const providerNames = { openai:'OpenAI',google:'Google',anthropic:'Anthropic',mistral:'Mistral',deepseek:'DeepSeek',zai:'Z.ai (GLM)',kimi:'Kimi',openrouter:'OpenRouter',custom:'Custom' };
const marks = { openai:'◉',google:'G',anthropic:'A',mistral:'M',deepseek:'D',zai:'Z',kimi:'K',openrouter:'⌘',custom:'◇' };
const storageKey = 'tokencost-scenario-v1';
let state = structuredClone(DEFAULTS), customModels = [], catalog, models = [], results = [], formulaType = 'math', visibleLimit = 18, formulaText = '';
let toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,3500); }
function cleanState(value) {
  const next = structuredClone(DEFAULTS);
  if (!value || typeof value !== 'object') return next;
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'providers') { if (Array.isArray(value.providers)) next.providers=value.providers.filter(p=>Object.hasOwn(providerNames,p)); }
    else if (typeof value[key] === typeof DEFAULTS[key]) next[key]=value[key];
  }
  // Older saved scenarios showing every original provider should also show the new providers.
  if (['openai','google','anthropic','mistral','openrouter'].every(p=>next.providers.includes(p))) {
    next.providers=[...new Set([...next.providers,'deepseek','zai','kimi'])];
  }
  return next;
}
function cleanCustom(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0,50).filter(m=>m && typeof m.name==='string' && typeof m.id==='string' && m.id.startsWith('custom:') && Number.isFinite(m.input) && m.input>=0 && Number.isFinite(m.output) && m.output>=0).map(m=>({
    ...m, provider:'custom', name:m.name.slice(0,100), source:safeURL(m.source), tools:m.tools?.search && Number.isFinite(m.tools.search.rate) && m.tools.search.rate>=0 ? {search:{name:'Custom web search',rate:m.tools.search.rate,unit:'calls',source:safeURL(m.source)}} : {},
    context: Number.isFinite(m.context) && m.context>0 ? m.context : null, cached:Number.isFinite(m.cached)&&m.cached>=0 ? m.cached:null, cacheWrite:Number.isFinite(m.cacheWrite)&&m.cacheWrite>=0?m.cacheWrite:null,
    batch:!!m.batch, efforts:[],contextPrices:[],priceChanges:[],requestFee:0
  }));
}
function restore() {
  try {
    const raw=location.hash.startsWith('#scenario=') ? decodeURIComponent(location.hash.slice(10)) : localStorage.getItem(storageKey);
    if (!raw || raw.length>200000) return;
    const saved=JSON.parse(raw); state=cleanState(saved.state); customModels=cleanCustom(saved.customModels);
  } catch { toast('Could not restore that scenario. Using the default workload.'); }
}
function persist() { try { localStorage.setItem(storageKey,JSON.stringify({state,customModels})); } catch { /* Storage is optional. */ } }
function syncInputs() {
  for (const input of $$('[data-state]')) {
    const key=input.dataset.state;
    if (document.activeElement !== input) input.value=state[key];
  }
  $$('[data-mode]').forEach(button=>{ const active=button.dataset.mode===state.mode;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active)); });
  $('#rate-fields').hidden=state.mode!=='rate'; $('#total-fields').hidden=state.mode!=='total';
  $('#reasoning-field').hidden=state.outputMode!=='visible';
  $('.estimate-top .tag').textContent=state.tier==='batch'?'BATCH PRICING':'STANDARD PRICING';
  $('#model-search').value=state.query;
}
function renderProviders() {
  const providers=Object.keys(providerNames).filter(p=>models.some(m=>m.provider===p));
  $('#provider-filters').innerHTML=providers.map(p=>`<button class="provider-chip ${state.providers.includes(p)?'selected':''}" data-provider="${p}" aria-pressed="${state.providers.includes(p)}"><span class="chip-dot"></span>${providerNames[p]}</button>`).join('');
}
function renderModelSelect() {
  if (!models.some(m=>m.id===state.selected)) state.selected=DEFAULTS.selected;
  $('#selected-model').innerHTML=Object.keys(providerNames).map(p=>`<optgroup label="${providerNames[p]}">${models.filter(m=>m.provider===p).map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  $('#selected-model').value=state.selected;
}
function current() { return results.find(r=>r.model.id===state.selected) || results[0]; }
function renderSummary() {
  const r=current();if(!r)return;
  const valid=validate(state).length===0;
  const marker=$('#selected-provider');marker.className=`provider-mark ${r.model.provider}`;marker.textContent=marks[r.model.provider];
  const parts=money(r.total).split('.');
  $('#total-price').innerHTML=r.eligible?`${esc(parts[0])}<span>.${parts[1]}</span>`:'<span>Check scenario</span>';
  $('#total-caption').textContent=valid?`for ${num(r.requests)} requests over ${num(state.days)} days${state.retries?' · retries included':''}`:'Update the highlighted assumptions to calculate costs.';
  for (const [id,value] of [['per-request',per(r.perRequest)],['per-day',money(r.perDay)],['per-month',money(r.monthly)]]) $('#'+id).textContent=r.eligible?value:'—';
  $('#total-input').innerHTML=valid?`${compact(r.inputTokens)} <small>tokens</small>`:'—';
  $('#total-output').innerHTML=valid?`${compact(r.outputTokens)} <small>tokens</small>`:'—';
  $('#total-requests').textContent=valid?compact(r.requests):'—';
  const buckets=[['Input tokens',r.input,'#697be9'],['Output tokens',r.output,'#a5b3ef'],['Cache reads + writes',r.cacheRead+r.cacheWrite,'#72b6a5'],['Reasoning tokens',r.reasoning,'#bc9de3'],['Tools + storage',r.toolCost,'#e9bd9c']];
  let offset=0;const circumference=2*Math.PI*62;
  $('#donut').innerHTML='<circle cx="80" cy="80" r="62" fill="none" stroke="#eef1f7" stroke-width="17"/>'+buckets.filter(b=>b[1]>0&&r.eligible).map(([,cost,color])=>{ const fraction=r.total?cost/r.total:0;const length=fraction*circumference;const svg=`<circle cx="80" cy="80" r="62" fill="none" stroke="${color}" stroke-width="17" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}"/>`;offset+=length;return svg; }).join('');
  $('#token-share').textContent=r.eligible?`${r.total?Math.round((r.total-r.toolCost)/r.total*100):0}%`:'—';
  $('#legend').innerHTML=buckets.map(([label,cost,color])=>`<div class="legend-row"><i style="background:${color}"></i><span>${label}</span><strong>${r.eligible?money(cost):'—'}</strong></div>`).join('');
  const noteItems=[...r.issues.map(i=>`<li class="issue">${esc(i)}</li>`),...r.notes.slice(0,3).map(i=>`<li>${esc(i)}</li>`)];
  $('#model-notes').innerHTML=`<a href="${esc(safeURL(r.model.source))}" target="_blank" rel="noopener noreferrer">Pricing source</a> · checked ${esc(r.model.checked||catalog.checked)}${r.model.apiBase?`<br>Direct API: <a href="${esc(safeURL(r.model.apiBase))}" target="_blank" rel="noopener noreferrer">${esc(r.model.apiBase)}</a>`:''}${noteItems.length?`<ul>${noteItems.join('')}</ul>`:''}`;
  const fees=r.model.tools||{};
  $('#tool-rates').innerHTML=['search','fileSearch','code'].map(kind=>{const t=fees[kind];return `<div class="tool-rate">${{search:'Web search',fileSearch:'File retrieval',code:'Code execution'}[kind]}<strong>${t?`${money(t.rate, t.rate && t.rate<.01?4:3)} / ${esc(t.unit)}`:'Not verified for this route'}</strong>${t?`<a href="${esc(safeURL(t.source))}" target="_blank" rel="noopener noreferrer">Source</a>`:'Use a custom fee if applicable'}</div>`;}).join('');
}
function filteredResults() {
  const q=state.query.toLowerCase().trim();
  const rows=results.filter(r=>state.providers.includes(r.model.provider)&&(!q||`${r.model.name} ${r.model.apiId}`.toLowerCase().includes(q)));
  if (state.sort==='total') rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.total-b.total);
  else if (state.sort==='total-desc') rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.total-a.total);
  else if (state.sort==='name') rows.sort((a,b)=>a.model.name.localeCompare(b.model.name));
  return rows;
}
function renderTable() {
  const rows=filteredResults();
  const max=Math.max(1,...rows.filter(r=>r.eligible).map(r=>r.total));
  $('#model-rows').innerHTML=rows.length?rows.slice(0,visibleLimit).map(r=>`<tr class="model-row ${r.model.id===state.selected?'is-selected':''} ${r.eligible?'':'incompatible'}" data-model="${esc(r.model.id)}"><td><button class="select-model" data-select="${esc(r.model.id)}" aria-pressed="${r.model.id===state.selected}" aria-label="Inspect ${esc(r.model.name)}"><span class="radio"></span><span class="provider-mark ${r.model.provider}">${marks[r.model.provider]}</span><span><span class="model-title">${esc(r.model.name)}</span><span class="model-subtitle">${esc(providerNames[r.model.provider])} · ${r.model.context?compact(r.model.context)+' context':'custom context'}${r.rates.longContext?' · higher-context tier':''}</span></span></button></td><td>${money(r.rates.input,3)}</td><td>${money(r.rates.output,3)}</td><td>${r.eligible?per(r.perRequest):'—'}</td><td class="row-total">${r.eligible?money(r.total):`<span class="status-label" title="${esc(r.issues.join(' '))}">Incompatible scenario</span>`}</td><td>${r.eligible?`<div class="cost-bar"><i style="width:${Math.min(100,r.total/max*100)}%"></i></div>`:`<span class="model-subtitle">${esc(r.issues[0])}</span>`}</td></tr>`).join(''):'<tr><td class="empty-row" colspan="6">No matching models. Change your search or provider filters.</td></tr>';
  $('#model-count').textContent=`Showing ${Math.min(visibleLimit,rows.length)} of ${rows.length} routes · ${rows.filter(r=>r.eligible).length} compatible`;
  $('#show-more').hidden=visibleLimit>=rows.length;
}
function numericFormula(r) {
  return spreadsheetFormula(r,state);
}
function renderFormula() {
  const r=current();if(!r)return;
  const s=state;
  const math=`TOTAL COST (USD)\n\nN = requests × (1 + retry overhead / 100)\n\nToken cost = N / 1,000,000 × (\n    uncached input tokens × input rate × token-tier factor\n  + cache-read tokens × cache-read rate × cache-tier factor\n  + cache-write tokens × cache-write rate × cache-tier factor\n  + answer tokens × output rate × token-tier factor\n  + additional reasoning tokens × reasoning rate × token-tier factor\n)\n\nTool cost = Σ (billable tool units × tool price)\n  + storage GB-days × storage price\n  + cached million-token-hours × cache storage price\n\nTotal cost = token cost + tool cost + route request fees\n\nCalling rate: N before retries = rate × active units/day × days\nBase input = uncached + cache reads + cache writes\nTool-result input is additional and uncached.\n\nSELECTED SCENARIO\n${r.model.name}\n${num(r.requests)} requests · ${num(s.input)} input · ${num(s.output)} output\n${r.eligible?money(r.total):'Incompatible scenario: '+r.issues.join(' ')}\n\nRates are USD per million tokens, resolved at the full prompt\nsize and pricing date before any Batch factor is applied.\nTotal-output mode already includes thinking; add reasoning only\nwhen the output input represents the visible answer alone.`;
  const js=`// Standalone, no dependencies. Replace model/workload for any model.\n// Rates: USD per million tokens. Tool rates: USD per named unit.\n// Context tiers, cache writes, retries, tools, and date changes included.\n// Inspect eligible/issues before using total.\n\n${validate.toString()}\n\n${volume.toString()}\n\n${ratesFor.toString()}\n\n${estimate.toString()}\n\nconst model = ${JSON.stringify(r.model,null,2)};\nconst workload = ${JSON.stringify(s,null,2)};\nconst result = estimate(model, workload);\nconsole.log({ eligible: result.eligible, issues: result.issues, totalUSD: result.total });`;
  const choices={math:math+`\n\nDirect DeepSeek rates use the manual off-peak workload mix\n(currently ${s.offPeak}%). This weights token prices, not tool fees.\nOther provider and OpenRouter rates keep their own billing rules.`,excel:numericFormula(r),javascript:js,rates:JSON.stringify({model:r.model.apiId,provider:r.model.provider,apiBase:r.model.apiBase,units:'USD per 1 million tokens; tool prices per stated unit',pricingDate:s.pricingDate,resolvedRates:r.rates,tools:r.model.tools,source:r.model.source},null,2)};
  formulaText=choices[formulaType];$('#formula-code').textContent=formulaText;
  $('#formula-help').textContent={math:'Use the rates for your model, prompt size and processing tier. All configured calls, storage and request fees are included. No API requests are made.',excel:'A standalone Excel / Google Sheets formula with your current numeric inputs and resolved rates. Paste into any cell. Change the inputs here and copy again for a different combination.',javascript:'A reusable, standalone estimator with your selected model and scenario. Edit model rates and workload inputs to calculate any combination. Unavailable combinations return eligible: false with reasons.',rates:'Source-backed rates for the selected route, resolved for this pricing date and input length. Raw catalog records retain thresholds and known future changes.'}[formulaType];
  $$('[data-formula]').forEach(b=>{b.classList.toggle('selected',b.dataset.formula===formulaType);b.setAttribute('aria-pressed',String(b.dataset.formula===formulaType));});
}
function render() {
  const issues=validate(state);$('#errors').hidden=!issues.length;$('#errors').textContent=issues.join(' ');
  results=models.map(model=>estimate(model,state));
  syncInputs();renderProviders();renderSummary();renderTable();renderFormula();persist();
}
async function copy(text, message) {
  try { await navigator.clipboard.writeText(text);toast(message); }
  catch { const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const done=document.execCommand('copy');field.remove();toast(done?message:'Select the formula and copy it manually.'); }
}
async function refreshOpenRouter() {
  const button=$('#refresh-openrouter');button.disabled=true;button.textContent='Refreshing…';
  try {
    const response=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(15000),credentials:'omit'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();if(!Array.isArray(data.data))throw new Error('Unexpected catalog format');
    const live=data.data.map(item=>normalizeOpenRouter(item)).filter(Boolean);
    if(!live.length)throw new Error('No usable text-model prices returned');
    models=[...models.filter(m=>m.provider!=='openrouter'),...live];
    if(!state.providers.includes('openrouter'))state.providers.push('openrouter');
    renderModelSelect();render();
    $('#catalog-status').textContent=`OpenRouter refreshed: ${num(live.length)} text routes. Prices are a current spot-rate snapshot; unsupported conditional rates are flagged. No API key was sent.`;
    toast('OpenRouter catalog refreshed.');
  } catch(error) { $('#catalog-status').textContent=`OpenRouter refresh failed (${error.message}). The last loaded catalog is still available.`; }
  finally { button.disabled=false;button.textContent='↻ Refresh OpenRouter'; }
}
function bind() {
  const timingLabel=document.createElement('label');timingLabel.className='field';timingLabel.innerHTML='DeepSeek off-peak workload <span class="muted">%</span><input data-state="offPeak" type="number" min="0" max="100" step="any" value="0"><span class="field-hint">Direct DeepSeek only. 0 = all peak; 100 = all off-peak. Use your expected request schedule.</span>';$('.advanced').insertBefore(timingLabel,$('.advanced .help'));
  const retention=$('select[data-state="cacheRetention"]');retention.options[0].textContent='Short · OpenAI 30m / Claude & Kimi 5m';retention.options[1].textContent='Long · OpenAI 12h / Claude & Kimi 1h';
  const orLabel=document.createElement('label');orLabel.className='field';orLabel.innerHTML='OpenRouter search engine<select data-state="orSearch"><option value="native">Native · route-advertised rate</option><option value="exa-fast">Exa instant / fast / auto · $7 / 1K</option><option value="exa-deep">Exa deep / deep-lite · $12 / 1K</option><option value="exa-reasoning">Exa deep-reasoning · $15 / 1K</option><option value="parallel-fast">Parallel turbo / fast · $1 / 1K</option><option value="parallel-basic">Parallel basic / advanced · $5 / 1K</option><option value="perplexity">Perplexity Search · $5 / 1K</option></select><span class="field-hint">Applies only to OpenRouter routes</span>';$('.tools-grid').append(orLabel);
  document.addEventListener('input',event=>{
    const input=event.target;if(!input.matches('[data-state]'))return;
    const key=input.dataset.state;
    state[key]=typeof DEFAULTS[key]==='number'?input.value===''?NaN:Number(input.value):input.value;
    visibleLimit=18;render();
  });
  document.addEventListener('click',event=>{
    const mode=event.target.closest('[data-mode]');if(mode){state.mode=mode.dataset.mode;render();}
    const provider=event.target.closest('[data-provider]');if(provider){const p=provider.dataset.provider;state.providers=state.providers.includes(p)?state.providers.filter(x=>x!==p):[...state.providers,p];visibleLimit=18;render();}
    const row=event.target.closest('[data-model]');if(row){state.selected=row.dataset.model;$('#selected-model').value=state.selected;render();}
    const tab=event.target.closest('[data-formula]');if(tab){formulaType=tab.dataset.formula;renderFormula();}
  });
  $('#selected-model').addEventListener('change',event=>{state.selected=event.target.value;render();});
  $('#model-search').addEventListener('input',event=>{state.query=event.target.value;visibleLimit=18;renderTable();persist();});
  $('#reset').addEventListener('click',()=>{state=structuredClone(DEFAULTS);visibleLimit=18;renderModelSelect();render();toast('Default workload restored.');});
  $('#show-more').addEventListener('click',()=>{visibleLimit+=50;renderTable();});
  $('#copy-formula').addEventListener('click',()=>copy(formulaText,'Formula copied.'));
  $('#share').addEventListener('click',()=>{
    if(validate(state).length){toast('Fix the scenario inputs before sharing.');return;}
    const link=new URL(location.href);link.hash='scenario='+encodeURIComponent(JSON.stringify({state,customModels}));copy(link.href,'Scenario link copied.');
  });
  $('#export').addEventListener('click',()=>{
    if(validate(state).length){toast('Fix the scenario inputs before exporting.');return;}
    const blob=new Blob(['\ufeff'+exportCSV(filteredResults())],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='llm-cost-comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Comparison exported.');
  });
  $('#refresh-openrouter').addEventListener('click',refreshOpenRouter);
  $('#custom-open').addEventListener('click',()=>$('#custom-dialog').showModal());
  $('#custom-close').addEventListener('click',()=>$('#custom-dialog').close());
  $('#custom-form').addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.target), optional=key=>data.get(key)===''?null:Number(data.get(key));
    const id='custom:'+crypto.randomUUID(),source=safeURL(data.get('source'));
    const m={id,apiId:id,provider:'custom',name:String(data.get('name')).trim(),input:Number(data.get('input')),output:Number(data.get('output')),cached:optional('cached'),cacheWrite:optional('cacheWrite'),context:optional('context'),batch:data.has('batch'),tools:optional('search')===null?{}:{search:{name:'Custom web search',rate:optional('search')/1000,unit:'calls',source}},source,checked:state.pricingDate,efforts:[]};
    customModels.push(m);models.push(m);state.selected=id;if(!state.providers.includes('custom'))state.providers.push('custom');
    $('#custom-dialog').close();event.target.reset();renderModelSelect();render();toast('Custom model added.');
  });
  window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#scenario=')){restore();models=[...models.filter(m=>m.provider!=='custom'),...customModels];renderModelSelect();render();}});
}
async function start() {
  restore();
  try {
    const response=await fetch('./data/catalog.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);
    catalog=await response.json();models=[...catalog.models,...customModels];
    $('#source-links').innerHTML=Object.entries(catalog.sources).map(([p,url])=>`<a href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${providerNames[p]} pricing</a>`).join('');
    $('#last-checked').textContent=`Catalog checked ${catalog.checked}`;
    renderModelSelect();bind();render();
  } catch(error) { $('#errors').hidden=false;$('#errors').textContent=`The price catalog could not be loaded (${error.message}). Serve this site through HTTP or GitHub Pages and reload.`; }
}
start();
