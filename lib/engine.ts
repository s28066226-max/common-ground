// The taste engine: turns a group of people into shared, fair, Qloo-grounded picks.
// Used by the Gemini agent (lib/agent.ts) and the MCP server (app/api/mcp).

import {
  ENTITY_TYPES,
  insights,
  search,
  searchTags,
  type AgeBucket,
  type Entity,
  type EntityType,
  type Tag,
} from "./qloo";

export interface PersonInput {
  name: string;
  loves: string;
  age?: AgeBucket;
}

export interface ResolvedPerson {
  name: string;
  age?: AgeBucket;
  seeds: Entity[];
  /** Foods, drinks and styles they love, as Qloo tags (used as place signals). */
  likes: Tag[];
  unresolved: string[];
  tasteTags: string[];
}

export interface Candidate extends Entity {
  groupScore: number;
  fit: Record<string, number>; // person -> 0..100
  sharedTags: Record<string, string[]>; // person -> tags that connect them to this pick
  source: "group" | `personal:${string}`;
}

// --------------------------------------------------------------------------
// 1. Resolve free-text loves into real Qloo entities (or tags, for foods and
//    styles). Search ranks loosely, so we pick by name match, never blindly.

export type LoveType = EntityType | "tag";

const SUPPORTED = new Set<string>(ENTITY_TYPES);

export async function resolvePerson(
  name: string,
  items: { query: string; type?: LoveType }[],
  age?: AgeBucket,
): Promise<ResolvedPerson> {
  const results = await Promise.all(
    items.map(async (item) => {
      try {
        if (item.type === "tag") return { item, tag: await resolveTag(item.query) };
        // Untyped (e.g. via MCP): an exact cuisine/genre tag beats a same-named venue.
        if (!item.type) {
          const tag = await resolveTag(item.query, "exact");
          if (tag) return { item, tag };
        }
        const entity = await resolveEntity(item.query, item.type);
        // Not a title or name? It may still be a taste ("ramen", "fishing").
        return entity ? { item, entity } : { item, tag: await resolveTag(item.query, "close") };
      } catch {
        return { item };
      }
    }),
  );

  const seeds: Entity[] = [];
  const likes: Tag[] = [];
  const unresolved: string[] = [];
  for (const { item, entity, tag } of results as { item: (typeof items)[number]; entity?: Entity; tag?: Tag }[]) {
    if (entity) {
      if (!seeds.some((s) => s.id === entity.id)) seeds.push(entity);
    } else if (tag) {
      if (!likes.some((t) => t.id === tag.id)) likes.push(tag);
    } else unresolved.push(item.query);
  }

  const tagCounts = new Map<string, number>();
  for (const s of seeds) for (const t of s.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tasteTags = [...likes.map((l) => l.name), ...[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)];
  return { name, age, seeds, likes, unresolved, tasteTags: [...new Set(tasteTags)].slice(0, 25) };
}

async function resolveEntity(query: string, type?: EntityType): Promise<Entity | undefined> {
  const [typed, any] = await Promise.all([
    type ? search(query, [type], 5).catch(() => []) : Promise.resolve([] as Entity[]),
    search(query, undefined, 8).catch(() => [] as Entity[]),
  ]);
  let best: Entity | undefined;
  let bestScore = 0;
  for (const e of [...typed, ...any]) {
    if (!SUPPORTED.has(e.type)) continue; // e.g. localities, albums: not usable as signals
    const base = nameScore(query, e.name);
    if (base === 0) continue;
    const score = base + (e.type === type ? 0.5 : 0) + (e.popularity ?? 0) * 0.3;
    if (score > bestScore) [best, bestScore] = [e, score];
  }
  return best;
}

// Prefer cuisine tags: they are the broadest signal for dining.
const TAG_PREFERENCE = [":cuisine:", ":specialty_dish:", ":genre:place:restaurant:", ":genre:"];
// Only a cuisine may override an entity of the same name ("Hamilton" is also a dish).
const FOOD_TAG = /:cuisine:/;

async function resolveTag(query: string, match: "any" | "close" | "exact" = "any"): Promise<Tag | undefined> {
  const tags = await searchTags(query, 8);
  const min = { any: 0, close: 2, exact: 3 }[match];
  const matching = tags.filter((t) => nameScore(query, t.name) >= min && (match !== "exact" || FOOD_TAG.test(t.id)));
  for (const marker of TAG_PREFERENCE) {
    const hit = matching.find((t) => t.id.includes(marker));
    if (hit) return hit;
  }
  return match === "exact" ? undefined : matching[0];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 3 exact, 2 one contains the other, 1 every query word appears, 0 no match. */
function nameScore(query: string, name: string): number {
  const q = norm(query);
  const n = norm(name);
  if (!q || !n) return 0;
  if (q === n) return 3;
  if ((n.includes(q) || q.includes(n)) && Math.min(q.length, n.length) / Math.max(q.length, n.length) >= 0.6) return 2;
  const words = n.split(" ");
  // Loose word match only for near-length names, so "Marvel Cinematic Universe"
  // doesn't become "Marvel Cinematic Universe Podcast - Agatha All Along".
  return n.length <= q.length * 1.6 && q.split(" ").every((w) => words.includes(w)) ? 1 : 0;
}

// --------------------------------------------------------------------------
// 2. Group recommendation with per-person fit and a maximin fairness score.
//
// Strategy:
//   a) Ask Qloo for picks driven by the *whole group's* signals.
//   b) Ask Qloo for each person's *own* top picks (so niche loves get a voice).
//   c) Re-score the pooled candidates against every person individually.
//   d) Rank by a blend of the minimum and mean fit, so a pick that delights
//      three people but alienates the fourth loses to one everybody likes.

export interface GroupQuery {
  type: EntityType;
  location?: string;
  filterTags?: string[];
  signalTags?: string[];
  priceMax?: number;
  take?: number;
}

export async function groupRecommend(people: ResolvedPerson[], q: GroupQuery) {
  const take = Math.min(q.take ?? 8, 15);
  const allSeeds = people.flatMap((p) => p.seeds.map((s) => s.id));
  // Food and drink tags only make sense as signals for places.
  const isPlace = q.type === "urn:entity:place" || q.type === "urn:entity:destination";
  const likesOf = (p: ResolvedPerson) => (isPlace ? p.likes.map((t) => t.id) : []);
  const allLikes = [...new Set(people.flatMap(likesOf))];
  const ages = [...new Set(people.map((p) => p.age).filter(Boolean))] as AgeBucket[];
  const base = {
    type: q.type,
    location: q.location,
    filterTags: q.filterTags,
    tags: q.signalTags,
    priceMax: q.priceMax,
  };

  const [groupPicks, ...personalLists] = await Promise.all([
    insights({ ...base, entities: allSeeds, tags: [...(q.signalTags ?? []), ...allLikes], ages, take: 30 }),
    ...people.map((p) =>
      insights({
        ...base,
        entities: p.seeds.map((s) => s.id),
        tags: [...(q.signalTags ?? []), ...likesOf(p)],
        ages: p.age ? [p.age] : undefined,
        take: 40,
      }).catch(() => [] as Entity[]),
    ),
  ]);

  // Pool: group picks + each person's top 6 personal picks.
  const pool = new Map<string, Entity & { source: Candidate["source"] }>();
  for (const e of groupPicks) pool.set(e.id, { ...e, source: "group" });
  people.forEach((p, i) => {
    for (const e of personalLists[i].slice(0, 6)) {
      if (!pool.has(e.id)) pool.set(e.id, { ...e, source: `personal:${p.name}` });
    }
  });
  const poolIds = [...pool.keys()];
  const inPool = (id: string) => pool.has(id);
  if (poolIds.length === 0) return { candidates: [] as Candidate[], note: "Qloo returned no matches for this query." };

  // Re-score the pool per person. Prefer an exact filter.entities scoring pass;
  // fall back to rank position in that person's own list.
  const perPerson = await Promise.all(
    people.map(async (p, i) => {
      const scores = new Map<string, number>();
      try {
        const scored = await insights({
          ...base,
          entities: p.seeds.map((s) => s.id),
          tags: [...(q.signalTags ?? []), ...likesOf(p)],
          filterEntities: poolIds,
          take: Math.min(poolIds.length, 50),
        });
        // Results come back ordered by affinity to this person's signals. Qloo
        // silently ignores unsupported params, so only trust ids from the pool.
        scored
          .filter((e) => inPool(e.id))
          .forEach((e, rank, arr) => scores.set(e.id, 1 - rank / Math.max(arr.length, 1)));
      } catch {
        /* fall through to rank fallback */
      }
      if (scores.size < poolIds.length / 2) {
        scores.clear();
        const own = personalLists[i];
        own.forEach((e, rank) => {
          if (inPool(e.id)) scores.set(e.id, 1 - rank / Math.max(own.length, 1));
        });
      }
      return scores;
    }),
  );

  // Normalise each person's scores to a 0..100 percentile over the pool so a
  // person with "loud" affinities doesn't dominate.
  const fit: Record<string, Record<string, number>> = {};
  people.forEach((p, i) => {
    const s = perPerson[i];
    const scored = poolIds.filter((id) => s.has(id)).sort((a, b) => s.get(b)! - s.get(a)!);
    const rankOf = new Map(scored.map((id, rank) => [id, rank]));
    for (const id of poolIds) {
      const rank = rankOf.get(id);
      // Picks outside a person's scored list get a low floor, not zero: absent ≠ disliked.
      (fit[id] ??= {})[p.name] =
        rank === undefined ? 10 : Math.max(20, Math.round(100 * (1 - rank / Math.max(scored.length, 2))));
    }
  });

  const candidates: Candidate[] = poolIds.map((id) => {
    const e = pool.get(id)!;
    const f = fit[id] ?? {};
    const vals = people.map((p) => f[p.name] ?? 0);
    const min = Math.min(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sharedTags: Record<string, string[]> = {};
    for (const p of people) {
      const overlap = e.tags.filter((t) => p.tasteTags.includes(t));
      if (overlap.length) sharedTags[p.name] = overlap.slice(0, 4);
    }
    return { ...e, groupScore: Math.round(0.55 * min + 0.45 * mean), fit: f, sharedTags };
  });

  candidates.sort((a, b) => b.groupScore - a.groupScore);
  return { candidates: candidates.slice(0, take), note: undefined };
}

// --------------------------------------------------------------------------
// 3. Small helpers exposed as agent tools.

export async function personalPicks(person: ResolvedPerson, type: EntityType, location?: string, take = 6) {
  const isPlace = type === "urn:entity:place" || type === "urn:entity:destination";
  return insights({
    type,
    entities: person.seeds.map((s) => s.id),
    tags: isPlace ? person.likes.map((t) => t.id) : undefined,
    ages: person.age ? [person.age] : undefined,
    location,
    take,
  });
}

export async function findTags(query: string): Promise<Tag[]> {
  return searchTags(query, 8);
}
