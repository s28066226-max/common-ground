// Sanity-checks your Qloo key and the API shapes Common Ground relies on.
// Usage: node --env-file=.env.local scripts/check-qloo.mjs

const BASE = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;
if (!KEY) throw new Error("Set QLOO_API_KEY (e.g. in .env.local)");

async function get(path, params) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { "X-Api-Key": KEY } });
  const body = await res.json().catch(() => ({}));
  console.log(`${res.status} ${path}`, JSON.stringify(params));
  return body;
}

const search = await get("/search", { query: "Radiohead", types: "urn:entity:artist", take: 1 });
const artist = search.results?.[0];
console.log("  search fields:", Object.keys(artist ?? {}).join(", "));
console.log("  →", artist?.name, artist?.entity_id);

const tags = await get("/v2/tags", { "filter.query": "ramen", take: 3 });
console.log("  tags:", JSON.stringify(tags.results?.tags?.slice(0, 3) ?? tags).slice(0, 300));

const recs = await get("/v2/insights", {
  "filter.type": "urn:entity:place",
  "signal.interests.entities": artist?.entity_id,
  "filter.location.query": "Brooklyn",
  take: 5,
});
const first = recs.results?.entities?.[0];
console.log("  insights fields:", Object.keys(first ?? {}).join(", "));
console.log("  properties:", Object.keys(first?.properties ?? {}).join(", "));
console.log("  →", recs.results?.entities?.map((e) => `${e.name} (${e.query?.affinity})`).join(" | "));

const ids = recs.results?.entities?.map((e) => e.entity_id).slice(0, 3) ?? [];
const scored = await get("/v2/insights", {
  "filter.type": "urn:entity:place",
  "signal.interests.entities": artist?.entity_id,
  "filter.entities": ids.join(","),
  take: 10,
});
const n = scored.results?.entities?.length ?? 0;
console.log(`  filter.entities ${n > 0 && n <= ids.length ? "supported ✓" : `ignored (got ${n}) – engine falls back to rank scoring`}`);
