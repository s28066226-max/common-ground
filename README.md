# Common Ground

**Plans for people who don't like the same things.**

Tell Common Ground what everyone in your group loves (bands, films, shows, books, food, brands). An agent maps each person onto Qloo's taste graph, scores every option against every person, and plans the one night, trip or offsite the whole group will actually enjoy.

**▶ Live demo: https://common-ground-delta-sandy.vercel.app**

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com) · Powered by [Qloo](https://qloo.com) + [Google Gemini](https://ai.google.dev)

---

## Why this needs Qloo

Group planning is a taste problem that LLMs can't solve alone. Ask a chatbot to plan a date for a Wong Kar-wai fan and a Fast & Furious fan and you get a popular restaurant and a vague sentence about "something for everyone". It has no way to measure how much *each* person will like a specific place.

Common Ground can measure it:

| | LLM alone | Common Ground |
|---|---|---|
| Understands each person | Guesses from names | Resolves loves to real Qloo entities and their taste tags |
| Picks options | Popular / generic | Qloo affinity driven by the group's actual signals, across domains |
| Fairness | None | Per-person fit score; ranked by **maximin**, so no one is left out |
| Evidence | Plausible prose | Shared taste tags and fit bars for every pick |
| Hallucinated venues | Possible | Impossible: the agent may only use entity IDs that Qloo returned |

Each plan ships with a **control experiment**: the same model, same brief, no Qloo. It runs side by side so you can see the difference yourself.

## How it works

```
people + loves ──► resolve_taste ──► Qloo /search  (free text → entities + taste tags)
                         │
occasion + city ──► Gemini agent decides slots (dinner, bar, film, trip, soundtrack…)
                         │
                   find_tags ──► Qloo /v2/tags      (cuisine / venue category IDs)
                         │
                  group_recommend ─┬─► Qloo /v2/insights  (whole-group signals)
                                   ├─► Qloo /v2/insights  (each person's own signals)
                                   └─► Qloo /v2/insights  (re-score pooled candidates per person)
                         │              → per-person fit (percentile) → fairness = 0.55·min + 0.45·mean
                         │
                   present_plan ──► validated against seen entity IDs ──► UI
```

- **Agentic loop:** Gemini chooses which slots the occasion needs, which tags to look up, when to give an outlier a slot of their own, and how to explain the trade-offs (`lib/agent.ts`).
- **Taste engine:** deterministic, LLM-free group scoring on top of Qloo (`lib/engine.ts`). The agent and the MCP server both use it.
- **Live trace:** every tool call streams to the UI over SSE, so you can watch the agent work.
- **Guardrails:** every tool call is schema-validated with Zod, every recommended `entity_id` must have come from Qloo, and the app falls back to a lighter Gemini model if the free tier is rate limited.

## Use it from your own agent (MCP)

Common Ground is also a remote MCP server, so any agent can get group-aware taste:

```bash
claude mcp add --transport http common-ground https://<your-deployment>/api/mcp
```

Tools: `taste_overlap` (group picks with per-person fit) and `find_taste_tags`.

## Run it locally

```bash
cp .env.example .env.local      # add QLOO_API_KEY and GEMINI_API_KEY (free)
npm install
node --env-file=.env.local scripts/check-qloo.mjs   # optional: verify your Qloo key
npm run dev
```

Open http://localhost:3000 and pick one of the examples.

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add `QLOO_API_KEY`, `GEMINI_API_KEY` and `NEXT_PUBLIC_REPO_URL` as environment variables.
4. Deploy. API routes allow up to 300 s (`maxDuration`) for longer agent runs.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · `@google/genai` (free Gemini models with automatic failover, function calling) · Qloo Hackathon API · Zod

## Data note

Qloo responses are cached privately in server memory only (allowed by the hackathon terms) and are never committed to this repository.

## License

[MIT](./LICENSE)
