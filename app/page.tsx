"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { Composer } from "@/components/Composer";
import { Logo } from "@/components/Logo";
import { EMPTY_DRAFT, PRESETS, type Draft } from "@/components/presets";
import { EMPTY_RUN, reduce, Results, type RunState } from "@/components/Results";
import type { AgentEvent } from "@/lib/agent";

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com";

export default function Home() {
  const [draft, setDraft] = useState<Draft>(() => structuredClone(PRESETS[0].draft));
  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function plan() {
    const body = {
      occasion: draft.occasion,
      city: draft.city.trim(),
      budget: draft.budget,
      notes: draft.notes.trim() || undefined,
      people: draft.people
        .filter((p) => p.name.trim() && p.loves.trim().length > 1)
        .map((p) => ({ name: p.name.trim(), loves: p.loves.trim(), age: p.age })),
    };
    setOrder(body.people.map((p) => p.name));
    setRun(EMPTY_RUN);
    setBusy(true);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    // The taste-blind control runs in parallel.
    fetch("/api/baseline", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((j) => setRun((s) => ({ ...s, baseline: j })))
      .catch(() => setRun((s) => ({ ...s, baseline: { error: "Baseline unavailable." } })));

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          if (!f.startsWith("data: ")) continue;
          const event = JSON.parse(f.slice(6)) as AgentEvent;
          setRun((s) => reduce(s, event));
        }
      }
    } catch (err) {
      setRun((s) => ({ ...s, error: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  const started = busy || run.steps.length > 0 || !!run.error;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <nav className="flex items-center justify-between py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo />
          Common Ground
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted">
          <a href="#mcp" className="hover:text-ink">
            Use as MCP
          </a>
          <a href={REPO_URL} className="hover:text-ink" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </nav>

      <header className="pt-6 pb-10 sm:pt-12 sm:pb-14">
        <h1 className="max-w-3xl font-display text-5xl leading-[1.02] sm:text-7xl">
          Plans for people who <em className="text-accent">don&apos;t</em> like the same things.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
          Tell us what everyone loves. An agent maps each person onto Qloo&apos;s taste graph, scores every option
          against every person, and plans the one night everybody actually enjoys.
        </p>
      </header>

      <main className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="lg:sticky lg:top-6">
          <Composer draft={draft} setDraft={setDraft} onSubmit={plan} busy={busy} />
          <button
            type="button"
            onClick={() => setDraft(structuredClone(EMPTY_DRAFT))}
            className="mt-3 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Start blank
          </button>
        </section>

        <section ref={resultsRef} className="min-w-0 scroll-mt-6" aria-live="polite">
          {started ? <Results run={run} order={order} busy={busy} /> : <HowItWorks />}
        </section>
      </main>

      <McpSection />
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["Resolve", "Each person's loves become real entities in Qloo's 250M+ entity taste graph: bands, films, books, places, brands."],
    ["Explore", "For every slot of the plan, the agent asks Qloo what the whole group, and each person alone, would gravitate to."],
    ["Score fairly", "Every candidate gets a fit score per person. Picks are ranked so nobody is left out (maximin), not just by the average."],
    ["Explain", "Gemini writes the plan, citing the taste evidence for each person, and is only allowed to use entities Qloo returned."],
  ];
  return (
    <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="font-display text-3xl">How it finds common ground</h2>
      <ol className="mt-6 flex flex-col gap-5">
        {steps.map(([t, d], i) => (
          <li key={t} className="grid grid-cols-[32px_1fr] gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 font-mono text-sm">{i + 1}</span>
            <span>
              <span className="font-semibold">{t}.</span> <span className="text-muted">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-6 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed text-muted">
        Why not just ask a chatbot? An LLM alone can name popular places, but it can&apos;t measure how much a Wong
        Kar-wai fan and a Fast &amp; Furious fan will each enjoy a specific restaurant. Each plan includes a control
        experiment so you can compare.
      </p>
    </div>
  );
}

function McpSection() {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "https://your-app.vercel.app",
  );
  return (
    <section id="mcp" className="mt-20 scroll-mt-6 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <h2 className="font-display text-3xl">Give your own agent taste</h2>
      <p className="mt-2 max-w-2xl text-muted">
        Common Ground is also an MCP server. Plug it into Claude, Cursor, ChatGPT or Antigravity and any agent can
        call <code className="font-mono text-ink">taste_overlap</code> whenever it recommends something to more than
        one person.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-2xl bg-ink p-4 font-mono text-sm text-bg">
        claude mcp add --transport http common-ground {origin}/api/mcp
      </pre>
    </section>
  );
}
