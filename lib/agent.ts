// The Common Ground agent: Gemini plans a shared experience for a group,
// using Qloo's taste graph as its only source of truth about what people love.

import type { Content, FunctionDeclaration, Part } from "@google/genai";
import { z } from "zod";
import {
  findTags,
  groupRecommend,
  personalPicks,
  resolvePerson,
  type Candidate,
  type LoveType,
  type ResolvedPerson,
} from "./engine";
import { generate } from "./llm";
import { ENTITY_TYPES, type AgeBucket, type Entity, type EntityType } from "./qloo";

const MAX_TURNS = 14;

export interface PlanRequest {
  people: { name: string; loves: string; age?: AgeBucket }[];
  occasion: string;
  city: string;
  budget?: "$" | "$$" | "$$$" | "$$$$";
  notes?: string;
}

export interface PlanItem {
  slot: string;
  headline: string;
  why_group: string;
  per_person: { person: string; reason: string }[];
  entity: Entity & { fit?: Record<string, number>; groupScore?: number };
}

export interface Plan {
  title: string;
  vibe: string;
  summary: string;
  items: PlanItem[];
  bridges: { people: string[]; insight: string }[];
  compromise_note: string;
  backups: { note: string; entity: Entity & { fit?: Record<string, number> } }[];
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool"; id: string; name: string; label: string }
  | { type: "tool_done"; id: string; summary: string; ok: boolean }
  | { type: "person"; person: ResolvedPerson }
  | { type: "candidates"; label: string; candidates: Candidate[] }
  | { type: "plan"; plan: Plan }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Tools

const typeEnum = [...ENTITY_TYPES];

const tools: FunctionDeclaration[] = [
  {
    name: "resolve_taste",
    description:
      "Map one person's free-text loves onto Qloo's taste graph. Call once per person before anything else. Split their text into distinct items. Use canonical names (\"Marvel movies\" -> \"Marvel Cinematic Universe\", \"Ghibli\" -> \"Studio Ghibli\"). Type: artist for musicians and bands; person for authors, directors, actors, chefs and creators; movie, tv_show, book, podcast, video_game, brand, place, destination for titles and names; \"tag\" for foods, cuisines, drinks, activities and styles (ramen, natural wine, fishing, K-beauty). Returns matched entities, liked tags, and dominant taste tags.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        person: { type: "string", description: "Exact name of the person as given by the user." },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", description: "Name of one thing they love, e.g. 'Radiohead'." },
              type: { type: "string", enum: [...typeEnum, "tag"] },
            },
            required: ["query", "type"],
          },
        },
      },
      required: ["person", "items"],
    },
  },
  {
    name: "find_tags",
    description:
      "Search Qloo tag IDs by keyword (e.g. 'ramen', 'cocktail bar', 'rooftop', 'vegetarian', 'jazz club'). Use the returned IDs as filter_tags in group_recommend to constrain venue category or cuisine. Tag IDs cannot be guessed.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "group_recommend",
    description:
      "The core tool. Given everyone resolved so far, ask Qloo for picks of one entity type that the WHOLE group will like. Returns candidates with a per-person fit score (0-100, percentile), a fairness-weighted groupScore, and the taste tags linking each person to each pick. Use for every slot of the plan (e.g. a restaurant, a film, a bar, an artist for the soundtrack, a destination).",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: typeEnum },
        purpose: { type: "string", description: "Short label of the slot, e.g. 'dinner' or 'after-dinner bar'." },
        location: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "City or neighbourhood. Required for places and destinations; null otherwise.",
        },
        filter_tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag IDs from find_tags that results must have (e.g. a restaurant category). Empty array for none.",
        },
        price_max: { anyOf: [{ type: "integer" }, { type: "null" }], description: "1-4, places only." },
      },
      required: ["type", "purpose", "location", "filter_tags", "price_max"],
    },
  },
  {
    name: "personal_picks",
    description:
      "One person's own top Qloo picks for an entity type. Use sparingly: to understand an outlier whose fit is low everywhere, or to find a 'gift' slot that is just for them.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        person: { type: "string" },
        type: { type: "string", enum: typeEnum },
        location: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["person", "type", "location"],
    },
  },
  {
    name: "present_plan",
    description:
      "Deliver the final plan. Call exactly once, at the end. Every entity_id MUST come from a group_recommend or personal_picks result.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Evocative 3-6 word name for the plan." },
        vibe: { type: "string", description: "One line describing the feel of the plan." },
        summary: { type: "string", description: "2-3 sentences: how this plan honours everyone." },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              slot: { type: "string", description: "When/what, e.g. '7:00 pm · Dinner'." },
              entity_id: { type: "string" },
              headline: { type: "string", description: "Punchy one-liner for this pick." },
              why_group: { type: "string", description: "Why this works for the group, citing the taste evidence." },
              per_person: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: { person: { type: "string" }, reason: { type: "string" } },
                  required: ["person", "reason"],
                },
              },
            },
            required: ["slot", "entity_id", "headline", "why_group", "per_person"],
          },
        },
        bridges: {
          type: "array",
          description: "Non-obvious cross-domain taste connections between people that you discovered.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { people: { type: "array", items: { type: "string" } }, insight: { type: "string" } },
            required: ["people", "insight"],
          },
        },
        compromise_note: {
          type: "string",
          description: "Honest note on who is stretching most and how the plan makes it up to them.",
        },
        backups: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              entity_id: { type: "string" },
              note: { type: "string", description: "One line about THIS entity only; never mention another venue." },
            },
            required: ["entity_id", "note"],
          },
        },
      },
      required: ["title", "vibe", "summary", "items", "bridges", "compromise_note", "backups"],
    },
  },
];

const SYSTEM = `You are Common Ground, a planning agent that designs one shared experience for a group of people with different tastes.

Your only source of truth about taste is Qloo's cultural taste graph, reached through your tools. Your own knowledge is useful for logistics and storytelling, never for deciding what someone will like.

How to work:
1. Call resolve_taste for every person (in parallel). Split their text into separate items with the best entity type.
2. Decide which slots the occasion needs (usually 2-4: e.g. dinner + a bar, a film + takeout, a destination + a restaurant + a road-trip podcast + a soundtrack artist). For every place slot, call find_tags first and pass a venue-category tag (e.g. urn:tag:genre:place:restaurant, a bar or cuisine tag) as filter_tags; without one Qloo returns landmarks and neighbourhoods.
3. Call group_recommend for each slot. Prefer candidates with the highest groupScore; avoid any pick where someone's fit is below 25 unless you compensate them elsewhere.
4. If one person keeps scoring low, look at their tags and give them one slot that is clearly theirs, then say so in compromise_note.
5. Finish by calling present_plan exactly once. Reasons must cite real evidence from the tool results (shared tags, fit scores, the person's own loves). Never invent venues, titles or IDs, and every note or reason must describe the entity it is attached to.

Write like a sharp friend with great taste: specific, warm, no filler. Keep per-person reasons to one sentence.`;

// ---------------------------------------------------------------------------
// Gemini does not enforce tool schemas, so every call is validated here; errors go back to the model.

// Models sometimes invent types ("urn:entity:food", "tv show"). Map what we can;
// anything else is left untyped and the engine infers it.
const TAG_LIKE = /tag|food|cuisine|dish|drink|activity|hobby|style|genre/;
function normaliseType(value: unknown): LoveType | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase().replace(/^urn:entity:/, "").replace(/[\s-]+/g, "_");
  const fixed = v === "videogame" || v === "game" ? "video_game" : v === "tvshow" || v === "show" ? "tv_show" : v;
  const urn = `urn:entity:${fixed}`;
  if ((ENTITY_TYPES as readonly string[]).includes(urn)) return urn as EntityType;
  return TAG_LIKE.test(fixed) ? "tag" : undefined;
}

const ResolveInput = z.object({
  person: z.string(),
  items: z.array(z.object({ query: z.string(), type: z.unknown().transform(normaliseType) })),
});
const TagsInput = z.object({ query: z.string() });
const GroupInput = z.object({
  type: z.enum(ENTITY_TYPES),
  purpose: z.string(),
  location: z.string().nullish(),
  filter_tags: z.array(z.string()).default([]),
  price_max: z.number().int().min(1).max(4).nullish(),
});
const PersonalInput = z.object({ person: z.string(), type: z.enum(ENTITY_TYPES), location: z.string().nullish() });
const PlanInput = z.object({
  title: z.string(),
  vibe: z.string(),
  summary: z.string(),
  items: z.array(
    z.object({
      slot: z.string(),
      entity_id: z.string(),
      headline: z.string(),
      why_group: z.string(),
      per_person: z.array(z.object({ person: z.string(), reason: z.string() })),
    }),
  ),
  bridges: z.array(z.object({ people: z.array(z.string()), insight: z.string() })).default([]),
  compromise_note: z.string().default(""),
  backups: z.array(z.object({ entity_id: z.string(), note: z.string() })).default([]),
});

const short = (s: string) => s.replace(/^urn:entity:/, "").replace("_", " ");

// ---------------------------------------------------------------------------

export async function runAgent(req: PlanRequest, emit: (e: AgentEvent) => void): Promise<void> {
  const people = new Map<string, ResolvedPerson>();
  const ages = new Map(req.people.map((p) => [p.name, p.age]));
  const seen = new Map<string, Entity & { fit?: Record<string, number>; groupScore?: number }>();
  let delivered = false;

  const budgetLevel = req.budget ? req.budget.length : null;
  const brief = [
    `Occasion: ${req.occasion}`,
    `City: ${req.city}`,
    budgetLevel ? `Budget: ${req.budget} (price level ≤ ${budgetLevel})` : null,
    req.notes ? `Notes: ${req.notes}` : null,
    "",
    "The group:",
    ...req.people.map((p) => `- ${p.name}${p.age ? ` (age ${p.age.replaceAll("_", " ")})` : ""}: ${p.loves}`),
  ]
    .filter((l) => l !== null)
    .join("\n");

  async function execute(tool: ToolCall): Promise<{ content: string; summary: string }> {
    switch (tool.name) {
      case "resolve_taste": {
        const input = ResolveInput.parse(tool.input);
        const person = await resolvePerson(input.person, input.items, ages.get(input.person));
        people.set(person.name, person);
        emit({ type: "person", person });
        return {
          summary: `${person.seeds.length + person.likes.length} matched${person.unresolved.length ? `, ${person.unresolved.length} unknown` : ""}`,
          content: JSON.stringify({
            person: person.name,
            matched: person.seeds.map((s) => ({ name: s.name, type: short(s.type), tags: s.tags.slice(0, 5) })),
            liked_tags: person.likes.map((t) => t.name),
            not_found: person.unresolved,
            dominant_taste_tags: person.tasteTags.slice(0, 12),
          }),
        };
      }
      case "find_tags": {
        const { query } = TagsInput.parse(tool.input);
        const tags = await findTags(query);
        return { summary: `${tags.length} tags`, content: JSON.stringify(tags) };
      }
      case "group_recommend": {
        const input = GroupInput.parse(tool.input);
        if (people.size === 0) throw new Error("Resolve everyone's taste first.");
        const { candidates, note } = await groupRecommend([...people.values()], {
          type: input.type,
          location: input.location ?? undefined,
          filterTags: input.filter_tags.length ? input.filter_tags : undefined,
          priceMax: input.price_max ?? budgetLevel ?? undefined,
          take: 8,
        });
        for (const c of candidates) seen.set(c.id, c);
        emit({ type: "candidates", label: input.purpose, candidates });
        return {
          summary: candidates.length ? `${candidates.length} candidates · top fairness ${candidates[0].groupScore}` : "no results",
          content: JSON.stringify({
            note,
            candidates: candidates.map((c) => ({
              entity_id: c.id,
              name: c.name,
              groupScore: c.groupScore,
              fit: c.fit,
              shared_tags: c.sharedTags,
              tags: c.tags.slice(0, 6),
              address: c.address,
              price_level: c.priceLevel,
              year: c.year,
              description: c.description,
            })),
          }),
        };
      }
      case "personal_picks": {
        const input = PersonalInput.parse(tool.input);
        const person = people.get(input.person);
        if (!person) throw new Error(`Unknown person ${input.person}; resolve them first.`);
        const picks = await personalPicks(person, input.type, input.location ?? undefined);
        for (const p of picks) if (!seen.has(p.id)) seen.set(p.id, p);
        return {
          summary: `${picks.length} picks for ${person.name}`,
          content: JSON.stringify(
            picks.map((p) => ({ entity_id: p.id, name: p.name, tags: p.tags.slice(0, 6), address: p.address })),
          ),
        };
      }
      case "present_plan": {
        const input = PlanInput.parse(tool.input);
        const unknown = [...input.items.map((i) => i.entity_id), ...input.backups.map((b) => b.entity_id)].filter(
          (id) => !seen.has(id),
        );
        if (unknown.length) {
          throw new Error(`These entity_ids were never returned by a tool: ${unknown.join(", ")}. Use only real results.`);
        }
        const plan: Plan = {
          ...input,
          items: input.items.map(({ entity_id, ...rest }) => ({ ...rest, entity: seen.get(entity_id)! })),
          backups: input.backups.map((b) => ({ note: b.note, entity: seen.get(b.entity_id)! })),
        };
        emit({ type: "plan", plan });
        delivered = true;
        return { summary: "plan delivered", content: "Plan delivered to the group." };
      }
      default:
        throw new Error(`Unknown tool ${tool.name}`);
    }
  }

  const contents: Content[] = [{ role: "user", parts: [{ text: brief }] }];
  let model: string | undefined;
  emit({ type: "status", text: "Reading the room…" });

  for (let turn = 0; turn < MAX_TURNS && !delivered; turn++) {
    const { response, model: served } = await generate({
      prefer: model,
      thoughts: true,
      contents,
      config: { systemInstruction: SYSTEM, tools: [{ functionDeclarations: tools }] },
    });
    model = served;

    const content = response.candidates?.[0]?.content;
    if (!content?.parts?.length) {
      const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason ?? "unknown";
      throw new Error(`Gemini returned no content (${reason}).`);
    }

    for (const part of content.parts) {
      if (part.text?.trim() && !part.functionCall) emit({ type: "thought", text: clip(part.text.trim(), 280) });
    }

    const calls: ToolCall[] = content.parts
      .filter((part) => part.functionCall?.name)
      .map((part, i) => ({
        callId: part.functionCall!.id,
        id: part.functionCall!.id ?? `t${turn}-${i}`,
        name: part.functionCall!.name!,
        input: part.functionCall!.args ?? {},
      }));

    // Keep the model's turn verbatim so its thought signatures survive.
    contents.push({ role: "model", parts: content.parts });

    if (calls.length === 0) {
      // Model stopped without delivering; nudge it to finish.
      contents.push({ role: "user", parts: [{ text: "Please call present_plan now with your final plan." }] });
      continue;
    }

    const results = await Promise.all(
      calls.map(async (tool): Promise<Part> => {
        emit({ type: "tool", id: tool.id, name: tool.name, label: describe(tool) });
        try {
          const { content, summary } = await execute(tool);
          emit({ type: "tool_done", id: tool.id, summary, ok: true });
          return { functionResponse: { id: tool.callId, name: tool.name, response: { output: content } } };
        } catch (err) {
          const msg =
            err instanceof z.ZodError
              ? `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`
              : err instanceof Error
                ? err.message
                : String(err);
          emit({ type: "tool_done", id: tool.id, summary: msg.slice(0, 120), ok: false });
          return { functionResponse: { id: tool.callId, name: tool.name, response: { error: msg } } };
        }
      }),
    );
    contents.push({ role: "user", parts: results });
  }

  if (!delivered) emit({ type: "error", message: "The agent didn't finish a plan. Try again or simplify the request." });
}

interface ToolCall {
  callId?: string; // Gemini's own id, echoed back only when it sent one
  id: string; // stable id for the UI trace
  name: string;
  input: unknown;
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function describe(tool: ToolCall): string {
  const i = tool.input as Record<string, unknown>;
  switch (tool.name) {
    case "resolve_taste":
      return `Mapping ${i.person}'s taste onto the Qloo graph`;
    case "find_tags":
      return `Looking up tags for “${i.query}”`;
    case "group_recommend":
      return `Finding a ${i.purpose} everyone will love${i.location ? ` in ${i.location}` : ""}`;
    case "personal_picks":
      return `Checking what ${i.person} would pick alone`;
    case "present_plan":
      return "Writing the plan";
    default:
      return tool.name;
  }
}
