// Shareable plans without a database: the plan is compressed into the URL hash.
// The hash never reaches the server, so shared plans stay between the people sharing them.

import type { Plan } from "./agent";

export interface SharedPlan {
  plan: Plan;
  order: string[];
  occasion: string;
  city: string;
  /** Each person's dominant taste tags, for the comparison view. */
  tastes: Record<string, string[]>;
}

export async function encodePlan(data: SharedPlan): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
  return toBase64Url(new Uint8Array(compressed));
}

export async function decodePlan(encoded: string): Promise<SharedPlan | undefined> {
  try {
    const bytes = fromBase64Url(encoded);
    const text = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    ).text();
    const data = JSON.parse(text) as SharedPlan;
    return data?.plan?.items ? { ...data, tastes: data.tastes ?? {} } : undefined;
  } catch {
    return undefined;
  }
}

export function planAsText({ plan, occasion, city }: SharedPlan): string {
  const lines = [`${plan.title} (${occasion}, ${city})`, plan.vibe, ""];
  for (const item of plan.items) {
    lines.push(`• ${item.slot}: ${item.entity.name}${item.entity.address ? `, ${item.entity.address}` : ""}`);
    lines.push(`  ${item.headline}`);
  }
  if (plan.backups.length) lines.push("", `Backup: ${plan.backups.map((b) => b.entity.name).join(", ")}`);
  return lines.join("\n");
}

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
