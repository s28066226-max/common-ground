# Devpost description (paste-ready)

## Common Ground: plans for people who don't like the same things

**The problem.** Most real plans are group plans: a date, a family weekend, a team offsite. Groups rarely share taste. Today's agents handle this by guessing. They suggest something popular and add a line about "something for everyone." They can't tell how much each person will enjoy a specific pick, so someone always gets ignored.

**What it does.** You enter the occasion, a city and a few things each person loves. Common Ground's agent then:

1. **Resolves** each person's loves into real entities in Qloo's taste graph (e.g. "Phoebe Bridgers" becomes an artist entity with taste tags).
2. **Decides the slots** the occasion needs: dinner and a bar, a film and takeout, or a destination, restaurants and a road-trip podcast.
3. **Scores every candidate against every person.** For each slot it asks Qloo what the whole group gravitates to and what each person would pick alone. It then re-scores the pooled options per person to get a 0–100 fit for each.
4. **Chooses fairly.** Picks are ranked by a maximin fairness score (0.55·min + 0.45·mean), so a place that thrills three people and alienates the fourth loses to one everyone likes. If one person keeps scoring low, the agent gives them a slot of their own and says so.
5. **Explains itself.** Each pick shows per-person fit bars, the shared taste tags behind it, a one-line reason for each person, and the cross-domain "taste bridges" it found. One example: two fans of very different music turned out to share a taste for late-night listening bars.

**What makes it Qloo-powered.** Without Qloo this app does not work. The fairness math needs real, per-person affinity scores across domains (music → restaurants, film → travel), and only a taste graph can provide them. To prove it, every plan includes a **control experiment**: the same Gemini model gets the same brief with no Qloo, and its plan sits next to ours. The agent can only recommend entity IDs that Qloo returned, and the server rejects anything else, so it cannot hallucinate venues.

**Agentic by design.**
- Gemini runs a function-calling loop with validated tools: `resolve_taste`, `find_tags`, `group_recommend`, `personal_picks`, `present_plan`.
- Every tool call and progress update streams live to the UI.
- **It's also an MCP server** (`/api/mcp`). Claude, Cursor, ChatGPT or Antigravity can call `taste_overlap` and get group-aware taste through one tool.

**Try it.** Open the live demo, choose an example ("Opposites attract", "Three generations" or "The team offsite") and press *Find our common ground*.

**Built with.** Qloo Hackathon API (`/search`, `/v2/tags`, `/v2/insights`), Google Gemini (`@google/genai`), Next.js 16, TypeScript, Tailwind CSS, Vercel.
