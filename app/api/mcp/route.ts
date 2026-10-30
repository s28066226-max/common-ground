// Common Ground as an MCP server (stateless Streamable HTTP, JSON responses).
// Lets any agent (Claude, ChatGPT, Cursor, Antigravity…) call the group-taste engine:
//   claude mcp add --transport http common-ground https://<your-domain>/api/mcp

import { z } from "zod";
import { findTags, groupRecommend, resolvePerson } from "@/lib/engine";
import { AGE_BUCKETS, ENTITY_TYPES } from "@/lib/qloo";

export const maxDuration = 120;

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const TasteOverlapInput = z.object({
  people: z
    .array(z.object({ name: z.string(), loves: z.array(z.string()).min(1).max(10), age: z.enum(AGE_BUCKETS).optional() }))
    .min(2)
    .max(6),
  type: z.enum(ENTITY_TYPES),
  location: z.string().optional(),
  filter_tags: z.array(z.string()).optional(),
  price_max: z.number().int().min(1).max(4).optional(),
});

const TOOLS = [
  {
    name: "taste_overlap",
    title: "Find picks a whole group will love",
    description:
      "Resolves each person's loves (artists, films, books, restaurants, brands…) in Qloo's taste graph, then returns picks of the requested entity type ranked by a fairness score (no one left behind), with a 0-100 fit per person and the taste tags that connect each person to each pick.",
    inputSchema: {
      type: "object",
      properties: {
        people: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              loves: { type: "array", items: { type: "string" }, description: "Things they love, e.g. ['Radiohead', 'Past Lives']" },
              age: { type: "string", enum: [...AGE_BUCKETS] },
            },
            required: ["name", "loves"],
          },
        },
        type: { type: "string", enum: [...ENTITY_TYPES], description: "What to recommend." },
        location: { type: "string", description: "City or neighbourhood (for places/destinations)." },
        filter_tags: { type: "array", items: { type: "string" }, description: "Qloo tag IDs from find_taste_tags." },
        price_max: { type: "integer", minimum: 1, maximum: 4 },
      },
      required: ["people", "type"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "find_taste_tags",
    title: "Search Qloo tag IDs",
    description: "Keyword search for Qloo tag IDs (cuisines, venue categories, genres) to use as filter_tags.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return rpcError(null, -32700, "Parse error");
  if (Array.isArray(body)) return rpcError(null, -32600, "Batching is not supported");

  const msg = body as RpcRequest;
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notification

  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "common-ground", title: "Common Ground (Qloo taste graph)", version: "1.0.0" },
        instructions:
          "Use taste_overlap whenever you must recommend something to more than one person. Pass each person's loves verbatim; recommend only the returned picks.",
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS });
    case "tools/call":
      return rpcResult(msg.id, await callTool(String(msg.params?.name), msg.params?.arguments));
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export function GET() {
  return new Response("Common Ground MCP endpoint. POST JSON-RPC here.", { status: 405, headers: { allow: "POST" } });
}

async function callTool(name: string, args: unknown) {
  try {
    if (name === "find_taste_tags") {
      const { query } = z.object({ query: z.string() }).parse(args);
      return text(await findTags(query));
    }
    if (name === "taste_overlap") {
      const input = TasteOverlapInput.parse(args);
      const people = await Promise.all(
        input.people.map((p) => resolvePerson(p.name, p.loves.map((query) => ({ query })), p.age)),
      );
      const { candidates, note } = await groupRecommend(people, {
        type: input.type,
        location: input.location,
        filterTags: input.filter_tags,
        priceMax: input.price_max,
        take: 8,
      });
      return text({
        resolved: people.map((p) => ({
          name: p.name,
          matched: p.seeds.map((s) => s.name),
          liked_tags: p.likes.map((t) => t.name),
          not_found: p.unresolved,
        })),
        note,
        picks: candidates.map((c) => ({
          name: c.name,
          entity_id: c.id,
          group_score: c.groupScore,
          fit: c.fit,
          shared_tags: c.sharedTags,
          address: c.address,
          description: c.description,
        })),
      });
    }
    return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

function text(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: RpcRequest["id"] | null, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: code === -32700 ? 400 : 200 });
}
