# Commercial LLM Cost Estimator

A static calculator for **OpenAI, Google Gemini, Anthropic Claude, Mistral, DeepSeek, Z.ai GLM, Kimi, and OpenRouter**, built for GitHub Pages. Compare a single workload across providers, inspect token and tool costs, and copy the calculation into your own code or spreadsheet. No API keys, account, backend, or paid API calls.

## Publish on GitHub Pages

1. Open [Settings → Pages](https://github.com/aflah02/Commercial-LLM-Cost-Estimator/settings/pages) and choose **GitHub Actions** as the build source.
2. Open [Actions](https://github.com/aflah02/Commercial-LLM-Cost-Estimator/actions), select **Test and deploy GitHub Pages**, and choose **Run workflow** on `main`. Future pushes to `main` deploy automatically.
3. Use the URL returned by the deployment. The expected project URL is `https://aflah02.github.io/Commercial-LLM-Cost-Estimator/`.

GitHub Pages hosting from a **private** repository requires an eligible GitHub plan. This project does not change repository visibility. If Pages is disabled, the build/tests can still pass while the deployment job requires the setting above.

Alternatively deploy `public/` directly from a branch, or serve the `dist/` output with any static host. All asset URLs are relative and work under a GitHub project subpath.

## Features

- 62 bundled routes across eight API providers: 15 OpenAI, six Gemini, seven Claude, six Mistral, two direct DeepSeek, five direct Z.ai GLM, three direct Kimi, and 18 independently sourced OpenRouter routes.
- Total request count, or requests per second/minute/hour/day with active hours, estimate days, and retry overhead.
- Total billed output versus visible answer plus additional reasoning. Effort filters use published route support and **never invent a token-price multiplier**.
- Cache reads/writes, short/long write retention, context tiers, dated promotions, Batch token pricing, and context/output compatibility checks.
- Direct DeepSeek peak/off-peak workload mix; direct Kimi's 60% Batch factor; separate provider and OpenRouter rates, capabilities and limits.
- Native search, retrieval, code/container units, file/cache storage, tool-result tokens, remaining free-search allowance, and arbitrary custom tool fees.
- OpenRouter external search presets for Exa, Parallel and Perplexity, plus advertised native search fees.
- Search/filter/sort comparison, detailed breakdown, CSV export, local scenario persistence, shareable scenario URLs, and custom models.
- Copyable math, Excel/Google Sheets numeric formulas, complete standalone JavaScript estimator, and resolved rates JSON.
- Public OpenRouter catalog refresh, without a key. Dated bundled models remain available if refresh fails.

## Run locally

Requires Node 22 or later. There are **no npm dependencies** to install.

```sh
npm test
npm run dev
```

Open `http://localhost:3000`. Build with `npm run build`; the output is `dist/`.

## Formula

With all token prices expressed as USD per **million** tokens:

```text
N = base requests × (1 + retry percentage / 100)

Token cost = N / 1,000,000 × (
    uncached input × input price × token-tier factor
  + cache-read input × cache-read price × cache-tier factor
  + cache-write input × cache-write price × cache-tier factor
  + answer output × output price × token-tier factor
  + additional reasoning × reasoning price × token-tier factor
)

Total cost = token cost
  + sum(billable tool units × unit price)
  + file storage + cache storage + request fees
```

In rate mode, requests are `rate × active units per day × days`, before retries. Cached input and write input are **disjoint fractions** of the original prompt. Additional tool-result tokens are uncached. In total-output mode, answer/output already includes reasoning; reasoning is added only in visible-output mode. Whole-request context tiers and known dated price changes are applied before tier factors.

The site's **Get the formula** section includes the selected inputs and rates, an immediately pasteable spreadsheet formula, and a standalone JavaScript version of the billing engine. To use the engine from code:

```js
import { DEFAULTS, estimate } from './public/assets/engine.mjs';

const model = {
  id: 'my-model', provider: 'custom', name: 'My model',
  input: 2, output: 10, cached: 0.1, cacheWrite: 2.5,
  context: 1_000_000, maxOutput: 128_000,
  batch: true, efforts: ['low', 'medium', 'high'],
  tools: { search: { name: 'Search', rate: 0.01, unit: 'calls' } }
};
const result = estimate(model, {
  ...DEFAULTS, requests: 100_000, input: 100_000, output: 5_000,
  outputMode: 'visible', reasoning: 5_000, search: 1
});
if (!result.eligible) throw new Error(result.issues.join('; '));
console.log(result.total); // 31,000 USD
```

## Data and sources

Initial catalog verified **November 20, 2026**. Sources are embedded per route and tool:

- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Google Gemini API pricing](https://aistudio.google.com/docs/pricing)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Mistral API pricing](https://docs.mistral.ai/inference/pricing)
- [Mistral reasoning support](https://docs.mistral.ai/inference/conversations/reasoning)
- [DeepSeek pricing and search fees](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek thinking modes](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Z.ai GLM API pricing](https://docs.z.ai/guides/overview/pricing)
- [Kimi model prices](https://platform.kimi.ai/)
- [Kimi Batch pricing](https://platform.kimi.ai/docs/pricing/batch)
- [Kimi cache billing](https://platform.kimi.ai/docs/guide/context-caching)
- [OpenRouter public models API](https://openrouter.ai/api/v1/models)
- [OpenRouter model schema](https://openrouter.ai/docs/guides/overview/models)
- [OpenRouter web search](https://openrouter.ai/tool/web-search/)

Edit `scripts/catalog-source.mjs` (and `scripts/openrouter-extra-seeds.json` for the additional raw OpenRouter snapshot), then run `node scripts/catalog-source.mjs` and `npm test` to update the committed snapshot. Avoid inferring OpenRouter rates from direct-provider rates. The public catalog refresh normalizes USD/token to USD/million and keeps route-specific effort support. Conditional rules that are not supported safely are flagged and excluded from compatible estimates.

### New direct API routes

| Service | API base | Bundled models |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash`, `deepseek-v4-pro` |
| Z.ai (international GLM PAYG) | `https://api.z.ai/api/paas/v4/` | `glm-5.3`, `glm-5.3-flash`, `glm-5.3-flashx`, `glm-5.3-flashx-legal`, `glm-5.2` |
| Kimi (international) | `https://api.moonshot.ai/v1` | `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`, `kimi-k3` |

The OpenRouter snapshot additionally includes DeepSeek V4.1 Flash / V4 Pro 0813, GLM 5.3 / Flash / FlashX / Prime, Kimi K3.1 Pro / K3, and explicitly priced Batch variants. OpenRouter's route prices and advertised efforts can differ substantially from direct APIs.

## Billing assumptions and limits

- This estimates API usage; subscription allowance multipliers and separately priced Work/Codex offerings are not substituted for API rates.
- Google Gemini 4 Carbon/Argon promotions change on December 1, 2026; Flash pricing/storage changes on January 1, 2027. Those published changes are modeled. Unknown post-promotion OpenAI prices are flagged, not invented.
- Gemini uses a different thinking-settings vocabulary; generic effort filtering does not claim direct support. Explicit Google cache-creation charges are not separately modeled; include actual creation input in your input budget and cache storage in million-token-hours. Gemini 4 is implicit-cache only.
- A 5,000-token total output budget may be consumed by thinking before a visible answer. A 5,000-token visible answer can consume additional billed reasoning. Pro mode may aggregate more input/output work; enter measured billed token totals.
- Native tools in Batch are not modeled; such combinations are excluded. OpenRouter `:batch` variants require Batch processing and already contain their own token rates; they are not discounted again.
- DeepSeek's direct API uses **peak rates by default**. Set the off-peak workload percentage under advanced settings to blend peak and off-peak token rates. Off-peak is half price; peak is Monday–Friday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays. The app does not infer holiday calendars or assume your calling schedule from a date. This setting does not discount OpenRouter routes or tool fees. Native server search/fetch has no separate fee as of November 18, 2026; returned context is input. Standalone Search/Fetch APIs instead cost $0.75/1K successful calls and can use the custom-tool charge. Direct Batch, explicit cache-write and runtime fees are not assumed when unverified.
- Direct Z.ai prices are international USD PAYG rates, not regional BigModel prices or Coding Plan points. GLM-5.3 cache reads are $0.26/M directly versus the independently advertised OpenRouter price. Native web search costs $0.01/use. Implicit cache storage is a limited-time free offering with no published expiry. Unknown Batch/code fees are excluded, not treated as free.
- Direct Kimi K3.1 Pro/K3 Batch costs **60%** of Standard. Highspeed Batch and Batch cache-write prices are not verified and those combinations are excluded. Short cache-write charges replace the same cache-miss input portion instead of charging it twice. Only K3's 1h write rate ($6/M) is verified; other long writes require updated rates. K3-series thinking is always on directly (low/high/max); OpenRouter may advertise other choices for its own routes. Native Kimi search/code fees require a custom charge because the current official fee table could not be verified. K2 entries are omitted from the direct catalog because they are limited to existing accounts and scheduled for retirement.
- Code units vary: OpenAI is **1 GB / 20-minute container sessions**; Anthropic is **container-hours** (minimum five minutes per session, free with applicable current search/fetch tool); Google is **executions** with no runtime fee. They are not equivalent workloads. Anthropic's 1,550 shared free monthly container hours are excluded; enter paid hours or use a custom charge for your actual allowance.
- Free-search allowance is manual, defaults to zero, and represents remaining allowance for that estimate. It is shared by provider/project where applicable; comparing models does not create a new allowance for each deployed model.
- Search-result, screenshot, schema, generated-code, and retrieved-file tokens must be included in token budgets. Mistral native tool fees were unavailable in fresh official docs; use a user-supplied custom fee. Unverified fees are not assumed to be zero.
- Specialized OpenAI routes require access. Their effort support and all tool combinations are not separately verified. OpenRouter endpoint-specific capabilities and pricing can differ. Check your actual selected endpoint before purchasing.
- Excludes taxes, credit purchase fees, regional premiums, reserved throughput, minimum cache lengths, capacity/rate-limit feasibility, and overhead not entered by the user. OpenRouter funding fees are **not** added as an inference surcharge.
- Custom inputs and scenarios stay in the browser. Shared links contain the scenario, including custom model names/rates; no credentials should be entered. Refreshing OpenRouter fetches its public catalog only. The stylesheet optionally loads Google Fonts; system fonts are the fallback.

## Project layout

```text
public/                 Static site; can be hosted as-is
  assets/engine.mjs     Pure, reusable cost engine
  assets/app.mjs        Browser interactions and formula export
  assets/style.css      Responsive layout
  data/catalog.json     Dated price snapshot
scripts/                Build, local server, catalog source
tests/                  Billing and compatibility regression tests
.github/workflows/      Test, build, and GitHub Pages deployment
```
