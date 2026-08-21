// The three interchangeable AI backends behind the Food tracker's two AI
// features, plus the helpers for reading whatever they hand back.
//
// This file exists because every one of those features used to ship as three
// near-identical edge functions (scan-label + scan-label-claude +
// scan-label-qwen, parse-meal + parse-meal-grok + parse-meal-qwen). Stripped
// of comments, the siblings differed by twelve to twenty-eight lines out of
// roughly two hundred; everything else, prompt included, was the same file
// copied. Keeping the copies in step was a written rule rather than a
// mechanism, and the rule had already been broken once: parse-meal-grok
// reasoned for months while its Claude twin did not, which quietly turned the
// provider toggle into a comparison of configurations instead of models.
//
// What actually differs per provider is the short list below: endpoint, auth
// header, request body shape, where the answer sits in the response. That is
// what a provider entry holds, and nothing else. A fourth backend is an entry
// here, not another copy of a whole function.
//
// THINKING POLICY, app-wide. Reading numbers off a printed table needs no
// deliberation, so every label scan passes reasoningBudget: null. Estimating
// portions by eye and then redoing the arithmetic until it clears a stated
// calorie floor is exactly what reasoning is for, so every meal parse passes a
// budget. The three models disagree on their own defaults (Qwen 3.7 on,
// Grok 4.3 on at effort 'low', Haiku 4.5 off unless handed a budget), so each
// entry states its setting explicitly rather than inheriting one. Callers say
// what they want; the entries know how to ask for it.

export type ProviderId = 'claude' | 'grok' | 'qwen';

export interface ModelImage {
  base64: string;
  mimeType: string;
}

export interface ModelCall {
  system: string;
  userText: string;
  // Optional: the meal parser runs text-only, photo-only or both.
  image?: ModelImage | null;
  // A ceiling on what may be generated, not a reservation, so one number
  // serves whether or not reasoning runs.
  maxTokens: number;
  // null means no deliberation at all. A number caps it: when the budget runs
  // out the model stops deliberating and starts writing, so this can never
  // truncate the answer the way maxTokens can. See REASONING_BUDGET in
  // parse-meal for where the number comes from.
  reasoningBudget: number | null;
}

// User-facing wording, so a shared failure path can still say "label reader"
// in the scanner and "meal estimator" in the parser.
export interface CallLabels {
  // Log prefix, e.g. 'scan-label'.
  tag: string;
  // Sentence subject for the missing-key case, e.g. 'Label scanning'.
  feature: string;
  // Noun for the reachability and failure cases, e.g. 'label reader'.
  subject: string;
}

export type ModelResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string };

type Json = Record<string, unknown>;

interface Provider {
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  // Only Qwen is sold through several front doors, so only Qwen has this.
  urlEnv?: string;
  defaultUrl: string;
  headers(apiKey: string): Record<string, string>;
  body(call: ModelCall, model: string): Json;
  text(data: Json): string;
}

// Walks an untyped content array and concatenates its text parts, optionally
// skipping parts that fail a test (Anthropic interleaves thinking blocks with
// text blocks in the same array).
function joinParts(parts: unknown, keep?: (part: Json) => boolean): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((raw) => {
      const part = (raw ?? {}) as Json;
      if (keep && !keep(part)) return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .join('');
}

// Both OpenAI-compatible providers build an identical messages array; only the
// reasoning field and the endpoint differ. Text first, image second. A plain
// string rather than a one-element array when there is no image, which is the
// shape the text-only meal path has always used.
function openAiMessages(call: ModelCall, userText: string): Json[] {
  return [
    { role: 'system', content: call.system },
    {
      role: 'user',
      content: call.image
        ? [
            { type: 'text', text: userText },
            {
              type: 'image_url',
              image_url: { url: `data:${call.image.mimeType};base64,${call.image.base64}`, detail: 'high' },
            },
          ]
        : userText,
    },
  ];
}

function openAiText(data: Json): string {
  const content = ((data?.choices as Json[] | undefined)?.[0]?.message as Json | undefined)?.content;
  if (typeof content === 'string') return content;
  // Some OpenAI-compatible servers return content as an array of parts.
  return joinParts(content);
}

const PROVIDERS: Record<ProviderId, Provider> = {
  claude: {
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5-20251001',
    defaultUrl: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }),
    body: (call, model) => ({
      model,
      max_tokens: call.maxTokens,
      // Haiku 4.5 predates adaptive thinking and reasons only when handed an
      // explicit budget, so "no reasoning" here means sending no field at all
      // rather than switching something off. budget_tokens must stay below
      // max_tokens and Anthropic's floor for it is 1024.
      ...(call.reasoningBudget ? { thinking: { type: 'enabled', budget_tokens: call.reasoningBudget } } : {}),
      system: call.system,
      messages: [{
        role: 'user',
        content: call.image
          ? [
              { type: 'text', text: call.userText },
              { type: 'image', source: { type: 'base64', media_type: call.image.mimeType, data: call.image.base64 } },
            ]
          : [{ type: 'text', text: call.userText }],
      }],
    }),
    // Messages API content is always an array of blocks (unlike OpenAI-style
    // APIs, which can return a bare string), and thinking arrives as its own
    // block type in that same array, so keep only the text ones.
    text: (data) => joinParts(data?.content, (p) => p.type === 'text'),
  },

  grok: {
    keyEnv: 'XAI_API_KEY',
    modelEnv: 'XAI_MODEL',
    // xAI rotates and deprecates model ids quickly: grok-4, the original
    // default here, was deprecated 2026-05-15. If grok-4.3 goes the same way,
    // point XAI_MODEL at the replacement instead of editing this file. A model
    // the API rejects surfaces xAI's own error text to the client.
    defaultModel: 'grok-4.3',
    defaultUrl: 'https://api.x.ai/v1/chat/completions',
    headers: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }),
    body: (call, model) => ({
      model,
      max_tokens: call.maxTokens,
      // Grok 4.3 reasons by default at effort 'low', so 'none' is a real
      // switch-off and not a formality: the label scanner was quietly paying
      // for deliberation nobody asked for until it was set.
      //
      // xAI exposes effort levels, not a token budget, so a caller's numeric
      // budget maps to 'low' rather than being approximated. That loses
      // nothing: 'low' is where the 1200-token budget the other two carry was
      // measured in the first place (1224 reasoning tokens on one meal photo),
      // so this endpoint IS the reference the other two are held to.
      reasoning_effort: call.reasoningBudget ? 'low' : 'none',
      messages: openAiMessages(call, call.userText),
    }),
    text: openAiText,
  },

  qwen: {
    keyEnv: 'QWEN_API_KEY',
    modelEnv: 'QWEN_MODEL',
    defaultModel: 'qwen3.7-flash',
    // Qwen is sold through several front doors that all speak the same
    // OpenAI-compatible dialect, and the right one depends on where the key
    // was minted. Default is Alibaba Cloud Model Studio's international
    // (Singapore) host; point QWEN_URL at dashscope.aliyuncs.com for a
    // mainland-China account, or at OpenRouter, without editing this file.
    urlEnv: 'QWEN_URL',
    defaultUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    headers: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }),
    body: (call, model) => {
      // QWEN_NO_THINK=1 forces reasoning off even where the caller asked for a
      // budget, the escape hatch if a wait ever proves worse than the estimate
      // is good.
      const forceOff = (Deno.env.get('QWEN_NO_THINK') ?? '').trim() === '1';
      // QWEN_ALLOW_THINK=1 sends neither kill switch, for a gateway that
      // rejects the flag outright (a 400 naming enable_thinking) rather than
      // ignoring it.
      const allowThink = (Deno.env.get('QWEN_ALLOW_THINK') ?? '').trim() === '1';
      const budget = forceOff ? null : call.reasoningBudget;
      // Two independent kill switches when reasoning is meant to be off,
      // because the front doors selling this model honour different ones: the
      // body flag is Alibaba's own extension, /no_think is the in-prompt
      // equivalent that survives a gateway which drops unknown fields.
      const suppress = !budget && !allowThink;
      return {
        model,
        max_tokens: call.maxTokens,
        ...(budget ? { enable_thinking: true, thinking_budget: budget } : suppress ? { enable_thinking: false } : {}),
        messages: openAiMessages(call, suppress ? `${call.userText}\n/no_think` : call.userText),
      };
    },
    // Qwen keeps reasoning in a separate `reasoning_content` field, so
    // `content` holds the answer alone whether or not thinking ran. Reading
    // only `content` therefore stays correct even if a gateway ignores both
    // kill switches above; that path costs tokens and latency, not accuracy.
    text: openAiText,
  },
};

// Listed explicitly rather than derived with `raw in PROVIDERS`: `in` walks the
// prototype chain, so a body carrying provider: "toString" would pass that
// check and then blow up on an undefined entry.
const PROVIDER_IDS: string[] = ['claude', 'grok', 'qwen'];

// There is no client-facing provider picker any more (see callModelWithFallback
// below for why claude/grok still sit in the table). This only exists so a
// manual curl can still force one exact provider for debugging. It may only
// select a key in the fixed table above, never carry a URL or a secret name
// of its own.
export function isProviderId(raw: unknown): raw is ProviderId {
  return typeof raw === 'string' && PROVIDER_IDS.includes(raw);
}

// One request to one provider. Never throws: every failure comes back as
// { ok: false } with the status and the message the client should see.
export async function callModel(id: ProviderId, call: ModelCall, labels: CallLabels): Promise<ModelResult> {
  const provider = PROVIDERS[id];
  const apiKey = Deno.env.get(provider.keyEnv) ?? '';
  if (!apiKey) {
    return { ok: false, status: 503, error: `${labels.feature} is not set up yet (missing ${provider.keyEnv}).` };
  }
  const model = (Deno.env.get(provider.modelEnv) ?? '').trim() || provider.defaultModel;
  const url = (provider.urlEnv ? (Deno.env.get(provider.urlEnv) ?? '').trim() : '') || provider.defaultUrl;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: provider.headers(apiKey),
      body: JSON.stringify(provider.body(call, model)),
    });
  } catch (e) {
    console.error(`[${labels.tag}] ${id} fetch error:`, e);
    return { ok: false, status: 502, error: `Could not reach the ${labels.subject}. Try again.` };
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error(`[${labels.tag}] ${id} error`, resp.status, detail);
    const reason = errReason(detail);
    const subject = labels.subject.charAt(0).toUpperCase() + labels.subject.slice(1);
    return { ok: false, status: 502, error: `${subject} failed (${resp.status})${reason ? ': ' + reason : ''}` };
  }

  const data = await resp.json().catch(() => null);
  return { ok: true, text: provider.text((data ?? {}) as Json) };
}

// Tries `primary`; only a transport/HTTP-level failure (network error, non-2xx,
// missing API key) triggers a retry against `fallback`. A successful response
// that happens to be empty or unparseable ("not a nutrition label", "no food
// found") is a valid answer, not a failure, and is returned as-is rather than
// silently redone on another model at the caller's expense.
//
// This is the whole reason claude and grok stay in the provider table even
// though nothing points a user at them any more: Qwen runs by default for the
// cost, and the other one is the safety net for when Qwen itself is down.
export async function callModelWithFallback(
  primary: ProviderId,
  fallback: ProviderId,
  call: ModelCall,
  labels: CallLabels,
): Promise<ModelResult> {
  const result = await callModel(primary, call, labels);
  if (result.ok) return result;
  console.error(`[${labels.tag}] ${primary} failed (${result.status}): ${result.error}. Falling back to ${fallback}.`);
  return callModel(fallback, call, labels);
}

// Pull the first balanced JSON object out of the model's text, tolerant of an
// accidental ```json fence or a stray sentence around it.
export function extractJson(text: string): Json | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// Best-effort short reason from a provider's error body, so a rejected model
// id (or an out-of-credit account) is visible to the user instead of a bare
// status code. All three wrap the message the same way.
export function errReason(raw: string): string {
  try {
    const j = JSON.parse(raw);
    const m = j?.error?.message ?? j?.error ?? j?.message;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 160);
  } catch (_) { /* not JSON */ }
  return raw.trim().slice(0, 160);
}

// CLAUDE.md's "no em dashes" rule is enforced on committed source by
// tools/check-emdash.cjs, which cannot touch runtime LLM output, so a prompt
// instruction alone is not a guarantee. Replace any that slip through.
// Matches by Unicode escape (U+2014), not the literal character, so
// check-emdash.cjs's own grep has nothing to flag in this file.
export function stripEmDash(s: string): string {
  return s.replace(/\u2014/g, ', ');
}
