// Gemini access tuned for the free tier: several free models in priority order,
// a per-request timeout, and a cooldown for any model that is overloaded or out
// of quota, so one busy model never stalls a plan.

import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentConfig, type GenerateContentParameters } from "@google/genai";

const FREE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
];
const MODELS = [...new Set([process.env.GEMINI_MODEL, ...FREE_MODELS].filter(Boolean) as string[])];
const TIMEOUT_MS = 45_000;
const cooldownUntil = new Map<string, number>();

let client: GoogleGenAI | undefined;

export interface GenerateOptions extends Omit<GenerateContentParameters, "model"> {
  /** Try this model first (keeps one conversation on one model). */
  prefer?: string;
  /** Ask for short reasoning summaries alongside the answer. */
  thoughts?: boolean;
}

export async function generate({ prefer, thoughts, ...params }: GenerateOptions) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const now = Date.now();
  const ordered = [...new Set([prefer, ...MODELS].filter(Boolean) as string[])];
  const available = ordered.filter((m) => (cooldownUntil.get(m) ?? 0) <= now);

  let lastError: unknown;
  for (const model of available.length ? available : ordered) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.models.generateContent({
          ...params,
          model,
          config: { ...params.config, ...thinkingFor(model, thoughts), httpOptions: { timeout: TIMEOUT_MS } },
        });
        return { response, model };
      } catch (err) {
        lastError = err;
        // A dropped connection isn't the model's fault: retry the same model briefly.
        if (isNetworkError(err) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const cooldown = cooldownFor(err);
        if (cooldown === undefined) throw err;
        cooldownUntil.set(model, Date.now() + cooldown);
        break;
      }
    }
  }
  throw lastError;
}

function isNetworkError(err: unknown) {
  return err instanceof Error && !(err instanceof ApiError) && /fetch failed|ECONNRESET|ETIMEDOUT|socket|network/i.test(
    `${err.message} ${(err.cause as Error | undefined)?.message ?? ""} ${(err.cause as { code?: string } | undefined)?.code ?? ""}`,
  );
}

// Gemini 3 models take a thinking level; 2.5 models take a token budget.
function thinkingFor(model: string, thoughts?: boolean): Pick<GenerateContentConfig, "thinkingConfig"> {
  if (model.startsWith("gemini-3")) {
    return { thinkingConfig: { includeThoughts: !!thoughts, thinkingLevel: ThinkingLevel.LOW } };
  }
  return { thinkingConfig: { includeThoughts: !!thoughts, thinkingBudget: model.includes("lite") ? 0 : 1024 } };
}

function cooldownFor(err: unknown): number | undefined {
  if (err instanceof ApiError) {
    if (err.status === 429) return /quota/i.test(err.message) ? 10 * 60_000 : 60_000;
    if ([404, 500, 503, 504].includes(err.status)) return 2 * 60_000;
    return undefined;
  }
  if (err instanceof Error && /abort|timeout|fetch failed/i.test(`${err.name} ${err.message}`)) return 2 * 60_000;
  return undefined;
}

export function describeLlmError(err: unknown): string | undefined {
  if (isNetworkError(err)) return "Couldn't reach Gemini (network hiccup). Please try again.";
  if (!(err instanceof ApiError)) return undefined;
  if (err.status === 429) return "Gemini's free-tier limit was reached. Wait a minute and try again.";
  if (err.status === 503 || err.status === 504) return "Gemini is overloaded right now. Try again in a minute.";
  if (err.status === 400 && /api key/i.test(err.message)) return "Gemini rejected the API key. Check GEMINI_API_KEY.";
  if (err.status === 401 || err.status === 403) return "Gemini rejected the API key. Check GEMINI_API_KEY.";
  return `Gemini API error ${err.status}: ${err.message.slice(0, 200)}`;
}
