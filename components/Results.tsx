"use client";

import { useState } from "react";
import type { AgentEvent, Plan } from "@/lib/agent";
import type { ResolvedPerson } from "@/lib/engine";
import { PlanView, type OptionList } from "./PlanView";
import { PERSON_COLORS } from "./presets";

export interface Step {
  id: string;
  name: string;
  label: string;
  done: boolean;
  ok?: boolean;
  summary?: string;
}

export interface RunState {
  steps: Step[];
  thoughts: string[];
  people: ResolvedPerson[];
  options: OptionList[];
  plan?: Plan;
  error?: string;
  baseline?: { text?: string; error?: string };
}

export const EMPTY_RUN: RunState = { steps: [], thoughts: [], people: [], options: [] };

export function reduce(state: RunState, e: AgentEvent): RunState {
  switch (e.type) {
    case "tool":
      return { ...state, steps: [...state.steps, { id: e.id, name: e.name, label: e.label, done: false }] };
    case "tool_done":
      return {
        ...state,
        steps: state.steps.map((s) => (s.id === e.id ? { ...s, done: true, ok: e.ok, summary: e.summary } : s)),
      };
    case "thought":
      return { ...state, thoughts: [...state.thoughts, e.text] };
    case "person":
      return { ...state, people: [...state.people.filter((p) => p.name !== e.person.name), e.person] };
    case "candidates":
      return { ...state, options: [...state.options, { label: e.label, candidates: e.candidates }] };
    case "plan":
      return { ...state, plan: e.plan };
    case "error":
      return { ...state, error: e.message };
    default:
      return state;
  }
}

export const colorFor = (order: string[]) => (name: string) =>
  PERSON_COLORS[Math.max(order.indexOf(name), 0) % PERSON_COLORS.length];

export function Results({
  run,
  order,
  busy,
  occasion,
  city,
}: {
  run: RunState;
  order: string[];
  busy: boolean;
  occasion: string;
  city: string;
}) {
  const color = colorFor(order);
  const people = order.map((n) => run.people.find((p) => p.name === n)).filter(Boolean) as ResolvedPerson[];
  const tastes = Object.fromEntries(people.map((p) => [p.name, p.tasteTags.slice(0, 6)]));

  return (
    <div className="flex flex-col gap-5">
      {busy && !run.plan && <Progress run={run} />}
      {people.length > 0 && <TasteProfiles people={people} color={color} />}
      <Trace run={run} busy={busy} />
      {run.error && (
        <div role="alert" className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm">
          {run.error}
        </div>
      )}
      {busy && !run.plan && <PlanSkeleton />}
      {run.plan && (
        <PlanView
          plan={run.plan}
          order={order}
          color={color}
          tastes={tastes}
          options={run.options}
          occasion={occasion}
          city={city}
        />
      )}
      {(run.plan || run.baseline) && <Compare baseline={run.baseline} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// While the agent works: a stage tracker and a placeholder for the plan.

const STAGES = [
  "Understanding everyone's taste",
  "Exploring options in Qloo",
  "Scoring every option for every person",
  "Writing your plan",
];

function stageOf(run: RunState) {
  const has = (name: string, done?: boolean) => run.steps.some((s) => s.name === name && (!done || s.done));
  if (has("present_plan")) return 3;
  if (has("group_recommend", true)) return 2;
  if (has("group_recommend") || has("find_tags")) return 1;
  return 0;
}

function Progress({ run }: { run: RunState }) {
  const stage = stageOf(run);
  return (
    <section className="rounded-3xl border border-line bg-surface p-4 sm:p-5" aria-label="Progress">
      <ol className="grid gap-2 sm:grid-cols-4">
        {STAGES.map((label, i) => (
          <li key={label} className="flex items-center gap-2 text-sm sm:flex-col sm:items-start sm:gap-1.5">
            <span
              className={`h-1.5 w-8 shrink-0 rounded-full transition-colors sm:w-full ${
                i < stage ? "bg-good" : i === stage ? "skeleton" : "bg-line"
              }`}
            />
            <span className={i === stage ? "font-medium" : i < stage ? "text-muted" : "text-muted/60"}>{label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface" aria-hidden="true">
      <div className="flex flex-col gap-3 border-b border-line p-5 sm:p-7">
        <div className="skeleton h-3 w-40" />
        <div className="skeleton h-10 w-3/4" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-5/6" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-4 border-b border-line p-5 last:border-0 sm:grid-cols-[112px_1fr] sm:p-7">
          <div className="skeleton h-20 w-20 rounded-2xl sm:h-28 sm:w-28" />
          <div className="flex flex-col gap-2.5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-5 w-1/2" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-16 w-full rounded-xl" />
          </div>
        </div>
      ))}
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
  const [userOpen, setOpen] = useState<boolean>();
  if (!run.steps.length && !busy) return null;
  const open = userOpen ?? !run.plan;
  const collapsed = !open;
  const lastThought = run.thoughts.at(-1)?.replace(/\*\*/g, "").split("\n")[0];

  return (
    <section className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <button
        onClick={() => setOpen(!open)}
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
