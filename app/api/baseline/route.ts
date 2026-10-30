// The "culturally blind" control: same model, same brief, no Qloo.
// Shown side by side in the UI so judges can see what the taste graph adds.

import { describeLlmError, generate } from "@/lib/llm";
import { PlanRequestSchema } from "@/lib/request";

export const maxDuration = 120;

export async function POST(request: Request) {
  const parsed = PlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const req = parsed.data;

  const brief = [
    `Plan a ${req.occasion} in ${req.city} for this group${req.budget ? ` (budget ${req.budget})` : ""}.`,
    ...req.people.map((p) => `- ${p.name}: ${p.loves}`),
    req.notes ? `Notes: ${req.notes}` : "",
    "Give 3 concrete picks (with names) and one line on why each works for the group. Under 150 words, plain text, no markdown.",
  ].join("\n");

  try {
    const { response } = await generate({ contents: brief });
    return Response.json({ text: response.text?.trim() || "(no answer)" });
  } catch (err) {
    return Response.json({ error: describeLlmError(err) ?? "Baseline unavailable" }, { status: 502 });
  }
}
