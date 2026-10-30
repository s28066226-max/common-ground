import { runAgent, type AgentEvent } from "@/lib/agent";
import { describeLlmError } from "@/lib/llm";
import { QlooError } from "@/lib/qloo";
import { PlanRequestSchema } from "@/lib/request";

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = PlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAgent(parsed.data, emit);
      } catch (err) {
        emit({ type: "error", message: friendly(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

function friendly(err: unknown): string {
  if (err instanceof QlooError) {
    if (err.status === 401) return "Qloo rejected the API key. Check QLOO_API_KEY.";
    if (err.status === 429) return "Qloo rate limit reached. Give it a minute and try again.";
    return err.message;
  }
  return describeLlmError(err) ?? (err instanceof Error ? err.message : "Something went wrong.");
}
