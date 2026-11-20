/** Pure billing calculations. All rates are USD per million tokens or per tool unit. */
export const DEFAULTS = Object.freeze({
  mode: 'total', requests: 100000, rate: 10, rateUnit: 'minute', hours: 24, days: 30,
  input: 100000, output: 5000, outputMode: 'total', reasoning: 0, toolTokens: 0,
  cache: 0, cacheWrite: 0, cacheRetention: 'short', cacheTokenHours: 0,
  search: 0, fileSearch: 0, code: 0, storage: 0, freeSearch: 0,
  customCalls: 0, customRate: 0, retries: 0, tier: 'standard', effort: 'all',
  pricingDate: '2026-11-20', selected: 'openai:gpt-6.1-sol', orSearch: 'native',
  providers: ['openai', 'google', 'anthropic', 'mistral', 'openrouter'], query: '', sort: 'provider'
});
export function validate(s) {
  const errors = [];
  for (const key of ['requests','rate','hours','days','input','output','reasoning','toolTokens','cache','cacheWrite','cacheTokenHours','search','fileSearch','code','storage','freeSearch','customCalls','customRate','retries']) {
    if (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < 0) errors.push(`${key} must be a non-negative finite number.`);
  }
  if (s.hours > 24) errors.push('Active hours per day cannot exceed 24.');
  if (s.days <= 0 || s.days > 3660) errors.push('Estimate days must be between 1 and 3,660.');
  if (s.cache + s.cacheWrite > 100) errors.push('Cache reads and writes cannot exceed 100% of input.');
  if (s.retries > 1000) errors.push('Retry overhead cannot exceed 1,000%.');
  if (!['total','rate'].includes(s.mode) || !['second','minute','hour','day'].includes(s.rateUnit)) errors.push('Choose a valid request-rate mode.');
  if (!['standard','batch'].includes(s.tier) || !['total','visible'].includes(s.outputMode)) errors.push('Choose a valid billing mode.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.pricingDate) || !Number.isFinite(Date.parse(s.pricingDate))) errors.push('Choose a valid pricing date.');
  return errors;
}
export function volume(s) {
  const perDay = { second: 3600 * s.hours, minute: 60 * s.hours, hour: s.hours, day: 1 }[s.rateUnit];
  const base = s.mode === 'total' ? s.requests : s.rate * perDay * s.days;
  return { base, attempts: base * (1 + s.retries / 100), days: s.days };
}
export function ratesFor(model, s, promptTokens) {
  let rates = { input: model.input, output: model.output, cached: model.cached, cacheWrite: s.cacheRetention === 'long' ? model.cacheWriteLong : model.cacheWrite, reasoning: model.reasoningRate ?? model.output, cacheStorage: model.cacheStorage };
  for (const change of model.priceChanges || []) if (s.pricingDate >= change.date) rates = { ...rates, ...change, reasoning: change.reasoning ?? change.output ?? rates.reasoning };
  let longContext = false;
  for (const rule of model.contextPrices || []) {
    if (promptTokens > rule.threshold) {
      rates = { ...rates, ...rule.rates };
      if (s.cacheRetention === 'long' && rule.rates.cacheWriteLong !== undefined) rates.cacheWrite = rule.rates.cacheWriteLong;
      if (rule.rates.output !== undefined && rule.rates.reasoning === undefined) rates.reasoning = rule.rates.output;
      longContext = true;
    }
  }
  return { ...rates, longContext };
}
export function estimate(model, s) {
  const issues = validate(s), notes = [], v = volume(s);
  const inputTokens = s.input + s.toolTokens;
  const outputTokens = s.outputMode === 'visible' ? s.output + s.reasoning : s.output;
  const reasoningTokens = s.outputMode === 'visible' ? s.reasoning : 0;
  const r = ratesFor(model, s, inputTokens);
  if (s.outputMode === 'total' && r.reasoning !== r.output) issues.push('This route prices reasoning separately. Use visible output plus reasoning tokens.');
  if (model.context && inputTokens + outputTokens > model.context) issues.push('Input plus output exceeds the context window.');
  if (model.maxInput && inputTokens > model.maxInput) issues.push('Input exceeds the model input limit.');
  if (model.maxOutput && outputTokens > model.maxOutput) issues.push('Output exceeds the model output limit.');
  if (s.effort !== 'all' && !model.efforts?.includes(s.effort)) issues.push(`Reasoning effort “${s.effort}” is not advertised for this route.`);
  if (s.tier === 'batch' && !model.batch) issues.push('Batch pricing is not available in this catalog for this route.');
  if (s.tier === 'batch' && (s.search || s.fileSearch || s.code)) issues.push('Native tools in Batch are not modeled; use Standard.');
  if (model.pricingUnsupported) issues.push('This route has conditional pricing not supported by this estimator.');
  if (model.promoEnd && s.pricingDate > model.promoEnd && !model.priceChanges?.some(c => c.date <= s.pricingDate)) issues.push('Published promotion has ended; update the rate before estimating.');
  if (s.cache && r.cached == null) issues.push('A cache-read rate is not published for this route.');
  if (s.cacheWrite && r.cacheWrite == null) issues.push('A cache-write rate is not published for this retention.');
  if (s.cacheTokenHours && r.cacheStorage == null) issues.push('Cache token-hour storage is not priced for this route.');
  const factor = s.tier === 'batch' && model.batch ? model.batchFactor ?? 0.5 : 1;
  const cacheFactor = s.tier === 'batch' ? model.batchCacheFactor ?? factor : 1;
  const readTokens = s.input * s.cache / 100, writeTokens = s.input * s.cacheWrite / 100;
  const uncachedTokens = Math.max(0, s.input - readTokens - writeTokens) + s.toolTokens;
  const input = uncachedTokens / 1e6 * r.input * factor * v.attempts;
  const cacheRead = readTokens / 1e6 * (r.cached ?? r.input) * cacheFactor * v.attempts;
  const cacheWrite = writeTokens / 1e6 * (r.cacheWrite ?? r.input) * cacheFactor * v.attempts;
  const output = s.output / 1e6 * r.output * factor * v.attempts;
  const reasoning = reasoningTokens / 1e6 * r.reasoning * factor * v.attempts;
  const tools = [], toolRates = model.tools || {};
  for (const kind of ['search', 'fileSearch', 'code']) {
    const amount = s[kind];
    if (!amount) continue;
    let tool = toolRates[kind];
    if (kind === 'search' && model.provider === 'openrouter' && s.orSearch !== 'native') {
      const engines = { 'exa-fast': ['Exa instant / fast / auto', .007], 'exa-deep': ['Exa deep / deep-lite', .012], 'exa-reasoning': ['Exa deep-reasoning', .015], 'parallel-fast': ['Parallel turbo / fast', .001], 'parallel-basic': ['Parallel basic / advanced', .005], 'perplexity': ['Perplexity Search', .005] };
      const choice = engines[s.orSearch];
      tool = choice ? { name: choice[0], rate: choice[1], unit: 'searches', source: 'https://openrouter.ai/tool/web-search/', note: 'External search engine; base result count only. Add any extra-result fees as a custom charge, and result context as input tokens.' } : null;
    }
    if (!tool || tool.rate == null) { issues.push(`No verified native ${kind} fee for this route. Use a custom fee or another route.`); continue; }
    const count = amount * v.attempts;
    const free = kind === 'search' ? s.freeSearch : 0;
    const toolRate = tool.freeWithSearch && s.search > 0 ? 0 : tool.rate;
    tools.push({ name: tool.name, units: Math.max(0, count - free), cost: Math.max(0, count - free) * toolRate, unit: tool.unit, source: tool.source });
    if (tool.note) notes.push(tool.note);
  }
  if (s.storage) {
    const storage = toolRates.storage;
    if (!storage) issues.push('No verified file storage fee for this route.');
    else tools.push({ name: 'File storage', units: Math.max(0, s.storage - (storage.free || 0)) * s.days, cost: Math.max(0, s.storage - (storage.free || 0)) * s.days * storage.rate, unit: 'GB-days', source: storage.source });
  }
  const cacheStorage = s.cacheTokenHours * (r.cacheStorage || 0);
  if (cacheStorage) tools.push({ name: 'Cache storage', units: s.cacheTokenHours, cost: cacheStorage, unit: 'million-token-hours' });
  const custom = s.customCalls * v.attempts * s.customRate / 1000;
  if (custom) tools.push({ name: 'Custom tool / infrastructure', units: s.customCalls * v.attempts, cost: custom, unit: 'calls' });
  const requestFees = (model.requestFee || 0) * v.attempts;
  if (requestFees) tools.push({ name: 'Route request fee', units: v.attempts, cost: requestFees, unit: 'requests' });
  const toolCost = tools.reduce((sum, t) => sum + t.cost, 0);
  const total = input + cacheRead + cacheWrite + output + reasoning + toolCost;
  if (r.longContext) notes.push('The entire request uses the published higher-context tier.');
  if (model.note) notes.push(model.note);
  if (s.outputMode === 'visible' && s.reasoning === 0 && model.efforts?.some(e => e !== 'none')) notes.push('No extra reasoning tokens assumed. Measure thinking usage for a realistic forecast.');
  return { model, rates: r, requests: v.attempts, baseRequests: v.base, total, input, cacheRead, cacheWrite, output, reasoning, tools, toolCost, perRequest: v.attempts ? total / v.attempts : 0, perDay: total / s.days, monthly: total / s.days * 30, inputTokens: inputTokens * v.attempts, outputTokens: outputTokens * v.attempts, eligible: issues.length === 0, issues: [...new Set(issues)], notes: [...new Set(notes)] };
}
/** Normalize documented OpenRouter catalog prices (USD/token) into USD/million. */
export function normalizeOpenRouter(item, checked = new Date().toISOString().slice(0, 10)) {
  const p = item.pricing || {};
  const number = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const million = value => number(value) === null ? null : number(value) * 1e6;
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || number(p.prompt) === null || number(p.completion) === null) return null;
  if (item.architecture?.output_modalities && !item.architecture.output_modalities.includes('text')) return null;
  const contextPrices = [];
  let pricingUnsupported = false;
  for (const override of p.overrides || []) {
    const keys = Object.keys(override);
    if (override.min_prompt_tokens === undefined || !Number.isFinite(Number(override.min_prompt_tokens)) || keys.some(k => !['min_prompt_tokens','prompt','completion','input_cache_read','input_cache_write','input_cache_write_1h'].includes(k))) { pricingUnsupported = true; continue; }
    const rates = {};
    for (const [from, to] of [['prompt','input'],['completion','output'],['input_cache_read','cached'],['input_cache_write','cacheWrite'],['input_cache_write_1h','cacheWriteLong']]) if (override[from] !== undefined) { if (million(override[from]) === null) pricingUnsupported = true; else rates[to] = million(override[from]); }
    contextPrices.push({ threshold: Number(override.min_prompt_tokens), rates });
  }
  return {
    id: `openrouter:${item.id}`, apiId: item.id, provider: 'openrouter', name: item.name,
    input: million(p.prompt), output: million(p.completion), cached: million(p.input_cache_read), cacheWrite: million(p.input_cache_write), cacheWriteLong: million(p.input_cache_write_1h),
    reasoningRate: million(p.internal_reasoning) ?? million(p.completion), requestFee: number(p.request) || 0,
    context: number(item.context_length), maxOutput: number(item.top_provider?.max_completion_tokens ?? item.max_completion_tokens),
    efforts: item.reasoning?.supported_efforts || item.supported_efforts || [], batch: false,
    contextPrices, pricingUnsupported,
    tools: p.web_search !== undefined && number(p.web_search) !== null ? { search: { name: 'Native web search', rate: number(p.web_search), unit: 'searches', source: 'https://openrouter.ai/api/v1/models', note: 'Native search rate advertised by this OpenRouter route; external search plugins have separate pricing.' } } : {},
    source: 'https://openrouter.ai/api/v1/models', checked, note: 'OpenRouter routing prices may vary by endpoint. Credit-purchase fees are excluded.'
  };
}
export function csvCell(value) { const text = typeof value === 'string' && /^[=+@\-\t\r]/.test(value) ? "'" + value : String(value ?? ''); return '"' + text.replaceAll('"', '""') + '"'; }
export function exportCSV(results) {
  const columns = ['Provider','Model','Eligible','Requests','Input USD','Cache read USD','Cache write USD','Output USD','Reasoning USD','Tools USD','Total USD','Per request USD','Notes'];
  return [columns, ...results.map(r => [r.model.provider,r.model.name,r.eligible,r.requests,r.input,r.cacheRead,r.cacheWrite,r.output,r.reasoning,r.toolCost,r.total,r.perRequest,[...r.issues,...r.notes].join(' | ')])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
/** A pasteable spreadsheet formula using the current numeric assumptions. */
export function spreadsheetFormula(r, s) {
  if (!r.eligible) return '=NA()';
  const m=r.model, p=r.rates, n=r.requests;
  const b=s.tier==='batch'&&m.batch?m.batchFactor??.5:1, bc=s.tier==='batch'?m.batchCacheFactor??b:1;
  const read=s.input*s.cache/100,write=s.input*s.cacheWrite/100,plain=s.input-read-write+s.toolTokens;
  const reasoning=s.outputMode==='visible'?s.reasoning:0;
  return `=${n}*((${plain}*${p.input}*${b}+${read}*${p.cached??p.input}*${bc}+${write}*${p.cacheWrite??p.input}*${bc}+${s.output}*${p.output}*${b}+${reasoning}*${p.reasoning}*${b})/1000000)`+r.tools.map(t=>`+(${t.units}*${t.units?t.cost/t.units:0})`).join('');
}
