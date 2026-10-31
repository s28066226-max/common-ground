// Thin, cached client for the Qloo hackathon API.
// Docs: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide

import type { AgeBucket, EntityType } from "./taxonomy";

export { AGE_BUCKETS, ENTITY_TYPES, type AgeBucket, type EntityType } from "./taxonomy";

const BASE_URL = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";

export class QlooError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Private server-side caching is explicitly allowed by the hackathon rules.
// We cache the in-flight promise so identical parallel requests share one call.
const cache = new Map<string, { at: number; data: Promise<unknown> }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const CACHE_MAX = 500;

// Hackathon keys are rate limited, so cap concurrency and back off on 429s.
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string, params: Record<string, string | number | undefined>) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new QlooError("QLOO_API_KEY is not set", 500);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `${BASE_URL}${path}?${qs.toString()}`;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data = fetchWithRetry(url, path, key);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(url, { at: Date.now(), data });
  data.catch(() => cache.delete(url));
  return data;
}

async function fetchWithRetry(url: string, path: string, key: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await withSlot(() =>
      fetch(url, { headers: { "X-Api-Key": key, accept: "application/json" }, signal: AbortSignal.timeout(20_000) }),
    );
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt + Math.random() * 400);
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new QlooError(`Qloo ${path} ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
}

// ---------------------------------------------------------------------------
// Normalised shapes. Qloo returns rich, loosely-typed objects; we keep only
// what the agent and UI need so tool results stay small.

export interface Entity {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  affinity?: number;
  popularity?: number;
  tags: string[];
  image?: string;
  description?: string;
  address?: string;
  city?: string;
  priceLevel?: number;
  rating?: number;
  year?: number;
  url?: string;
  lat?: number;
  lon?: number;
}

export interface Tag {
  id: string;
  name: string;
  type?: string;
}

// Search spells one type differently from Insights.
const SEARCH_TYPE: Record<string, string> = { "urn:entity:video_game": "urn:entity:videogame" };
const FROM_SEARCH_TYPE: Record<string, string> = { "urn:entity:videogame": "urn:entity:video_game" };

// Keep descriptive taste tags; drop encyclopedic noise ("Knights Of The Legion Of Honour").
// Occupations show up as genre tags on people ("Director"); they describe the job, not the taste.
const ROLE_WORD = /^(film )?(director|actor|actress|singer|songwriter|writer|author|producer|musician|rapper|screenwriter|composer)s?$/i;
const TASTE_TAG = /genre|style|theme|characteristic|audience|cuisine|ambience|specialty_dish|beverage_offering|setting/;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toEntity(raw: any): Entity {
  const p = raw?.properties ?? {};
  // Search returns `types: [...]`; Insights returns `type: "urn:entity"` plus `subtype`.
  const types: string[] = [...(raw?.types ?? []), raw?.subtype, raw?.type].filter(
    (t): t is string => typeof t === "string" && t.startsWith("urn:entity:"),
  );
  const rawType = types[0] ?? "unknown";
  const tags: { name?: string; type?: string }[] = raw?.tags ?? [];
  const tasteTags = tags.filter((t) => t?.name && TASTE_TAG.test(t.type ?? "") && !ROLE_WORD.test(t.name));
  return {
    id: raw?.entity_id ?? raw?.id,
    name: raw?.name,
    type: FROM_SEARCH_TYPE[rawType] ?? rawType,
    subtype: raw?.subtype,
    affinity: num(raw?.query?.affinity),
    popularity: num(raw?.popularity),
    tags: (tasteTags.length ? tasteTags : tags)
      .map((t) => t?.name)
      .filter((n): n is string => !!n)
      .slice(0, 12),
    image: p?.image?.url ?? (typeof p?.image === "string" ? p.image : undefined),
    description: truncate(p?.short_description ?? p?.description, 220),
    address: p?.address,
    city: p?.geocode?.city ?? p?.geocode?.name,
    priceLevel: num(p?.price_level),
    rating: num(p?.business_rating ?? p?.rating),
    year: num(p?.release_year ?? p?.publication_year),
    url: p?.websites?.[0] ?? p?.website ?? raw?.external?.resy?.[0]?.url,
    lat: num(raw?.location?.lat),
    lon: num(raw?.location?.lon),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function num(v: unknown) {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function truncate(s: unknown, n: number) {
  if (typeof s !== "string") return undefined;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// Endpoints

export async function search(query: string, types?: string[], take = 3): Promise<Entity[]> {
  const data = (await get("/search", {
    query,
    types: types?.map((t) => SEARCH_TYPE[t] ?? t).join(","),
    take,
  })) as { results?: unknown[] };
  return (data.results ?? []).map(toEntity).filter((e) => e.id && e.name);
}

export async function searchTags(query: string, take = 6): Promise<Tag[]> {
  const data = (await get("/v2/tags", { "filter.query": query, take })) as {
    results?: { tags?: { id?: string; tag_id?: string; name: string; type?: string }[] };
  };
  return (data.results?.tags ?? [])
    .map((t) => ({ id: t.id ?? t.tag_id ?? "", name: t.name, type: t.type }))
    .filter((t) => t.id);
}

export interface InsightsQuery {
  type: EntityType;
  entities?: string[];
  tags?: string[];
  filterTags?: string[];
  filterEntities?: string[];
  location?: string;
  ages?: AgeBucket[];
  priceMax?: number;
  take?: number;
  explain?: boolean;
}

export async function insights(q: InsightsQuery): Promise<Entity[]> {
  const isGeo = q.type === "urn:entity:place" || q.type === "urn:entity:destination";
  const data = (await get("/v2/insights", {
    "filter.type": q.type,
    "signal.interests.entities": q.entities?.join(","),
    "signal.interests.tags": q.tags?.join(","),
    "operator.signal.interests.tags": q.tags?.length ? "union" : undefined,
    "filter.tags": q.filterTags?.join(","),
    "filter.entities": q.filterEntities?.join(","),
    "filter.location.query": isGeo ? q.location : undefined,
    "signal.location.query": !isGeo ? q.location : undefined,
    "signal.demographics.age": q.ages?.join(","),
    "filter.price_level.max": q.type === "urn:entity:place" ? q.priceMax : undefined,
    "feature.explainability": q.explain ? "true" : undefined,
    take: Math.min(q.take ?? 10, 50),
  })) as { results?: { entities?: unknown[] } };
  return (data.results?.entities ?? []).map(toEntity).filter((e) => e.id && e.name);
}
