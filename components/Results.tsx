"use client";

import { useState } from "react";
import type { AgentEvent, Plan } from "@/lib/agent";
import type { ResolvedPerson } from "@/lib/engine";
import { PERSON_COLORS } from "./presets";

export interface Step {
  id: string;
  label: string;
  done: boolean;
  ok?: boolean;
  summary?: string;
}

export interface RunState {
  steps: Step[];
  thoughts: string[];
  people: ResolvedPerson[];
  plan?: Plan;
  error?: string;
  baseline?: { text?: string; error?: string };
}

export const EMPTY_RUN: RunState = { steps: [], thoughts: [], people: [] };

export function reduce(state: RunState, e: AgentEvent): RunState {
  switch (e.type) {
    case "tool":
      return { ...state, steps: [...state.steps, { id: e.id, label: e.label, done: false }] };
    case "tool_done":
      return {
        ...state,
        steps: state.steps.map((s) => (s.id === e.id ? { ...s, done: true, ok: e.ok, summary: e.summary } : s)),
      };
    case "thought":
      return { ...state, thoughts: [...state.thoughts, e.text] };
    case "person":
      return { ...state, people: [...state.people.filter((p) => p.name !== e.person.name), e.person] };
    case "plan":
      return { ...state, plan: e.plan };
    case "error":
      return { ...state, error: e.message };
    default:
      return state;
  }
}

export function Results({ run, order, busy }: { run: RunState; order: string[]; busy: boolean }) {
  const color = (name: string) => PERSON_COLORS[Math.max(order.indexOf(name), 0) % PERSON_COLORS.length];
  const people = order.map((n) => run.people.find((p) => p.name === n)).filter(Boolean) as ResolvedPerson[];

  return (
    <div className="flex flex-col gap-5">
      {people.length > 0 && <TasteProfiles people={people} color={color} />}
      <Trace run={run} busy={busy} />
      {run.error && (
        <div role="alert" className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm">
          {run.error}
        </div>
      )}
      {run.plan && <PlanView plan={run.plan} order={order} color={color} />}
      {(run.plan || run.baseline) && <Compare baseline={run.baseline} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TasteProfiles({ people, color }: { people: ResolvedPerson[]; color: (n: string) => string }) {
  return (
    <section className="rise rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">What Qloo understood</h3>
      <div className="flex flex-col gap-3">
        {people.map((p) => (
          <div key={p.name} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(p.name) }} />
              {p.name}
              {p.tasteTags.length > 0 && (
                <span className="truncate text-xs font-normal text-muted">· {p.tasteTags.slice(0, 4).join(", ")}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.seeds.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pr-2.5 pl-0.5 text-xs"
                  title={s.type.replace("urn:entity:", "")}
                >
                  {s.image ? (
                    <img src={s.image} alt="" className="h-5 w-5 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <span className="h-5 w-5 rounded-full" style={{ background: color(p.name), opacity: 0.35 }} />
                  )}
                  {s.name}
                </span>
              ))}
              {p.likes?.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs"
                  title="Qloo taste tag"
                >
                  <span className="text-muted">#</span>
                  {t.name}
                </span>
              ))}
              {p.unresolved.map((u) => (
                <span key={u} className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs text-muted line-through">
                  {u}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Trace({ run, busy }: { run: RunState; busy: boolean }) {
  const [open, setOpen] = useState(true);
  if (!run.steps.length && !busy) return null;
  const collapsed = !!run.plan && !open;
  const lastThought = run.thoughts.at(-1);

  return (
    <section className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left text-xs font-semibold tracking-wide text-muted uppercase"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2">
          {busy && <Spinner />}
          Agent trace · {run.steps.length} tool call{run.steps.length === 1 ? "" : "s"}
        </span>
        {run.plan && <span className="normal-case">{open ? "Hide" : "Show"}</span>}
      </button>
      {!collapsed && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {run.steps.map((s) => (
            <li key={s.id} className="rise flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {!s.done ? <Spinner /> : s.ok ? <span className="text-good">✓</span> : <span className="text-warn">!</span>}
              </span>
              <span className="min-w-0">
                {s.label}
                {s.summary && <span className="ml-1.5 font-mono text-xs text-muted">{s.summary}</span>}
              </span>
            </li>
          ))}
          {busy && run.steps.length === 0 && <li className="text-sm text-muted">Reading the room…</li>}
        </ol>
      )}
      {busy && lastThought && (
        <p className="mt-3 border-l-2 border-line pl-3 text-sm text-muted italic">{lastThought}</p>
      )}
    </section>
  );
}

function PlanView({ plan, order, color }: { plan: Plan; order: string[]; color: (n: string) => string }) {
  return (
    <article className="rise overflow-hidden rounded-3xl border border-line bg-surface">
      <header className="border-b border-line p-5 sm:p-7">
        <p className="text-xs font-semibold tracking-wide text-accent uppercase">{plan.vibe}</p>
        <h2 className="mt-1 font-display text-4xl leading-tight sm:text-5xl">{plan.title}</h2>
        <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-muted">{plan.summary}</p>
      </header>

      <ol className="divide-y divide-line">
        {plan.items.map((item, i) => (
          <li key={i} className="grid gap-4 p-5 sm:grid-cols-[112px_1fr] sm:p-7">
            <div className="flex gap-3 sm:flex-col">
              {item.entity.image ? (
                <img
                  src={item.entity.image}
                  alt=""
                  className="h-20 w-20 rounded-2xl object-cover sm:h-28 sm:w-28"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-2 font-display text-3xl text-muted sm:h-28 sm:w-28">
                  {item.entity.name[0]}
                </div>
              )}
              <p className="text-xs font-semibold tracking-wide text-muted uppercase sm:hidden">{item.slot}</p>
            </div>
            <div className="min-w-0">
              <p className="hidden text-xs font-semibold tracking-wide text-muted uppercase sm:block">{item.slot}</p>
              <h3 className="mt-0.5 text-xl font-semibold">{item.entity.name}</h3>
              <p className="text-sm text-muted">
                {[
                  item.entity.address,
                  item.entity.year,
                  item.entity.priceLevel ? "$".repeat(item.entity.priceLevel) : null,
                  item.entity.rating ? `★ ${item.entity.rating.toFixed(1)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-2 font-display text-xl leading-snug italic">{item.headline}</p>
              <p className="mt-1.5 text-sm leading-relaxed">{item.why_group}</p>

              {item.entity.fit && <FitBars fit={item.entity.fit} order={order} color={color} score={item.entity.groupScore} />}

              <ul className="mt-3 flex flex-col gap-1.5">
                {item.per_person.map((pp) => (
                  <li key={pp.person} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color(pp.person) }} />
                    <span>
                      <span className="font-medium">{pp.person}</span>
                      <span className="text-muted"> — {pp.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>

      {(plan.bridges.length > 0 || plan.compromise_note) && (
        <div className="grid gap-4 border-t border-line bg-surface-2/60 p-5 sm:grid-cols-2 sm:p-7">
          {plan.bridges.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Taste bridges we found</h4>
              <ul className="mt-2 flex flex-col gap-2.5">
                {plan.bridges.map((b, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    <span className="mr-1.5 inline-flex -space-x-1 align-middle">
                      {b.people.map((p) => (
                        <span key={p} className="h-3 w-3 rounded-full ring-2 ring-surface-2" style={{ background: color(p) }} />
                      ))}
                    </span>
                    {b.insight}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.compromise_note && (
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Who&apos;s stretching</h4>
              <p className="mt-2 text-sm leading-relaxed">{plan.compromise_note}</p>
            </div>
          )}
        </div>
      )}

      {plan.backups.length > 0 && (
        <div className="border-t border-line p-5 sm:p-7">
          <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">If that falls through</h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {plan.backups.map((b) => (
              <li key={b.entity.id} className="rounded-xl border border-line p-3 text-sm">
                <span className="font-medium">{b.entity.name}</span>
                <span className="text-muted"> — {b.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function FitBars({
  fit,
  order,
  color,
  score,
}: {
  fit: Record<string, number>;
  order: string[];
  color: (n: string) => string;
  score?: number;
}) {
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3">
      <div className="mb-2 flex items-baseline justify-between text-xs text-muted">
        <span>Taste fit per person (Qloo affinity, percentile)</span>
        {score !== undefined && (
          <span>
            Fairness score <span className="font-mono font-semibold text-ink">{score}</span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {order
          .filter((n) => n in fit)
          .map((n) => (
            <div key={n} className="grid grid-cols-[64px_1fr_32px] items-center gap-2 text-xs">
              <span className="truncate">{n}</span>
              <span className="h-2 overflow-hidden rounded-full bg-line">
                <span className="bar-grow block h-full rounded-full" style={{ width: `${fit[n]}%`, background: color(n) }} />
              </span>
              <span className="text-right font-mono text-muted">{fit[n]}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function Compare({ baseline }: { baseline?: RunState["baseline"] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="block text-xs font-semibold tracking-wide text-muted uppercase">Control experiment</span>
          <span className="text-sm">What the same model plans with no taste graph</span>
        </span>
        <span className="text-sm text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-3 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed whitespace-pre-wrap text-muted">
          {baseline?.text ?? baseline?.error ?? "Generating the taste-blind plan…"}
          <p className="mt-3 border-t border-line pt-3 text-xs not-italic">
            No per-person fit, no evidence, and no guarantee the venues exist. Common Ground only recommends entities
            that Qloo returned and scored for every person.
          </p>
        </div>
      )}
    </section>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent"
      aria-label="Working"
    />
  );
}
