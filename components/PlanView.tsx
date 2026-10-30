"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { Plan, PlanEntity, PlanItem } from "@/lib/agent";
import type { Candidate } from "@/lib/engine";
import { encodePlan, planAsText, type SharedPlan } from "@/lib/share";
import type { MapStop } from "./PlanMap";

const PlanMap = dynamic(() => import("./PlanMap").then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="skeleton h-64 w-full rounded-none sm:h-72" />,
});

export interface OptionList {
  label: string;
  candidates: Candidate[];
}

interface Props {
  plan: Plan;
  order: string[];
  color: (name: string) => string;
  /** Each person's dominant taste tags, for the side-by-side comparison. */
  tastes: Record<string, string[]>;
  /** Every candidate list the agent saw, so users can compare and swap. */
  options: OptionList[];
  occasion: string;
  city: string;
}

export function PlanView({ plan, order, color, tastes, options, occasion, city }: Props) {
  const [swaps, setSwaps] = useState<Record<number, PlanEntity>>({});
  const items = useMemo(
    () => plan.items.map((item, i) => (swaps[i] ? { ...item, entity: swaps[i], swapped: true } : item)),
    [plan.items, swaps],
  );
  const people = order.filter((n) => items.some((it) => it.entity.fit && n in it.entity.fit) || n in tastes);

  const stops: MapStop[] = useMemo(
    () =>
      items.flatMap((it, i) =>
        it.entity.lat !== undefined && it.entity.lon !== undefined
          ? [{ n: i + 1, name: it.entity.name, slot: it.slot, lat: it.entity.lat, lon: it.entity.lon }]
          : [],
      ),
    [items],
  );

  const shared: SharedPlan = {
    plan: { ...plan, items: items.map(({ slot, headline, why_group, per_person, entity }) => ({ slot, headline, why_group, per_person, entity })) },
    order,
    occasion,
    city,
    tastes,
  };

  return (
    <article className="rise overflow-hidden rounded-3xl border border-line bg-surface">
      <header className="border-b border-line p-5 sm:p-7">
        <p className="text-xs font-semibold tracking-wide text-accent uppercase">{plan.vibe}</p>
        <h2 className="mt-1 font-display text-4xl leading-tight sm:text-5xl">{plan.title}</h2>
        <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-muted">{plan.summary}</p>
        <ShareBar data={shared} />
      </header>

      {people.length > 0 && <FitMatrix items={items} people={people} color={color} />}

      {stops.length > 0 && (
        <div className="border-b border-line">
          <PlanMap stops={stops} />
        </div>
      )}

      <ol className="divide-y divide-line">
        {items.map((item, i) => (
          <PlanStop
            key={i}
            n={i + 1}
            item={item}
            swapped={"swapped" in item}
            people={people}
            color={color}
            tastes={tastes}
            alternatives={alternativesFor(plan.items[i].entity.id, options)}
            onSwap={(entity) => setSwaps((s) => ({ ...s, [i]: entity }))}
            onUndo={() =>
              setSwaps((s) => {
                const next = { ...s };
                delete next[i];
                return next;
              })
            }
          />
        ))}
      </ol>

      {(plan.bridges.length > 0 || plan.compromise_note) && (
        <div className="grid gap-4 border-t border-line bg-surface-2/60 p-5 sm:grid-cols-2 sm:p-7">
          {plan.bridges.length > 0 && (
            <div>
              <h4 className={eyebrow}>Taste bridges we found</h4>
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
              <h4 className={eyebrow}>Who&apos;s stretching</h4>
              <p className="mt-2 text-sm leading-relaxed">{plan.compromise_note}</p>
            </div>
          )}
        </div>
      )}

      {plan.backups.length > 0 && (
        <div className="border-t border-line p-5 sm:p-7">
          <h4 className={eyebrow}>If that falls through</h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {plan.backups.map((b) => (
              <li key={b.entity.id} className="rounded-xl border border-line p-3 text-sm">
                <span className="font-medium">{b.entity.name}</span>
                <span className="text-muted"> — {b.note}</span>
                <Actions entity={b.entity} compact />
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Plan at a glance: every person × every stop, coloured by fit.

function FitMatrix({
  items,
  people,
  color,
}: {
  items: PlanItem[];
  people: string[];
  color: (n: string) => string;
}) {
  return (
    <section className="border-b border-line p-5 sm:p-7" aria-label="How well each stop fits each person">
      <h3 className={eyebrow}>Plan at a glance · fit per person</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[320px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="w-20" />
              {items.map((it, i) => (
                <th key={i} className="text-left align-bottom font-normal">
                  <a href={`#stop-${i + 1}`} className="group flex items-center gap-1.5 text-xs text-muted hover:text-ink">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink">
                      {i + 1}
                    </span>
                    <span className="line-clamp-2 group-hover:underline">{it.entity.name}</span>
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p}>
                <th scope="row" className="pr-2 text-left text-xs font-medium">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: color(p) }} />
                  {p}
                </th>
                {items.map((it, i) => {
                  const v = it.entity.fit?.[p];
                  return (
                    <td
                      key={i}
                      className="h-9 rounded-lg text-center font-mono text-xs"
                      style={
                        v === undefined
                          ? { background: "var(--surface-2)", color: "var(--muted)" }
                          : { background: `color-mix(in oklab, ${color(p)} ${15 + v * 0.75}%, var(--surface))` }
                      }
                      title={v === undefined ? "Not scored" : `${p}: ${v}/100`}
                    >
                      {v ?? "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className="pr-2 text-left text-xs font-semibold text-muted">
                Fairness
              </th>
              {items.map((it, i) => (
                <td key={i} className="text-center font-mono text-xs font-semibold">
                  {it.entity.groupScore ?? "–"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One stop: details, per-person comparison, actions, alternatives.

function PlanStop({
  n,
  item,
  swapped,
  people,
  color,
  tastes,
  alternatives,
  onSwap,
  onUndo,
}: {
  n: number;
  item: PlanItem;
  swapped: boolean;
  people: string[];
  color: (n: string) => string;
  tastes: Record<string, string[]>;
  alternatives: Candidate[];
  onSwap: (e: PlanEntity) => void;
  onUndo: () => void;
}) {
  const e = item.entity;
  const meta = [e.address, e.year, e.priceLevel ? "$".repeat(e.priceLevel) : null, e.rating ? `★ ${e.rating.toFixed(1)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li id={`stop-${n}`} className="scroll-mt-6 p-5 sm:p-7">
      <div className="grid gap-4 sm:grid-cols-[112px_1fr]">
        <div className="relative h-20 w-20 sm:h-28 sm:w-28">
          {e.image ? (
            <img src={e.image} alt="" className="h-full w-full rounded-2xl object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-2xl bg-surface-2 font-display text-3xl text-muted">
              {e.name[0]}
            </div>
          )}
          <span className="absolute -top-2 -left-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-accent text-xs font-semibold text-accent-ink">
            {n}
          </span>
        </div>

        <div className="min-w-0">
          <p className={eyebrow}>{item.slot}</p>
          <h3 className="mt-0.5 text-xl font-semibold">
            {e.name}
            {swapped && (
              <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 align-middle text-xs font-normal text-muted">
                your pick ·{" "}
                <button onClick={onUndo} className="underline hover:text-ink">
                  undo
                </button>
              </span>
            )}
          </h3>
          {meta && <p className="text-sm text-muted">{meta}</p>}
          {!swapped && (
            <>
              <p className="mt-2 font-display text-xl leading-snug italic">{item.headline}</p>
              <p className="mt-1.5 text-sm leading-relaxed">{item.why_group}</p>
            </>
          )}
          {swapped && e.description && <p className="mt-2 text-sm leading-relaxed text-muted">{e.description}</p>}
          <Actions entity={e} />
        </div>
      </div>

      <PersonComparison item={item} swapped={swapped} people={people} color={color} tastes={tastes} />

      {alternatives.length > 0 && (
        <Alternatives current={e} alternatives={alternatives} people={people} color={color} onSwap={onSwap} />
      )}
    </li>
  );
}

// The visual comparison: each person's taste next to this pick, with overlaps highlighted.
function PersonComparison({
  item,
  swapped,
  people,
  color,
  tastes,
}: {
  item: PlanItem;
  swapped: boolean;
  people: string[];
  color: (n: string) => string;
  tastes: Record<string, string[]>;
}) {
  const e = item.entity;
  const pickTags = e.tags.slice(0, 6);
  const reasons = Object.fromEntries(item.per_person.map((p) => [p.person, p.reason]));

  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className={eyebrow}>Who it&apos;s for</h4>
        {e.groupScore !== undefined && (
          <span className="text-xs text-muted">
            Fairness score <span className="font-mono font-semibold text-ink">{e.groupScore}</span>
          </span>
        )}
      </div>
      {pickTags.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          <span className="mr-1">This pick:</span>
          {pickTags.map((t) => (
            <Chip key={t} active={people.some((p) => e.sharedTags?.[p]?.includes(t))}>
              {t}
            </Chip>
          ))}
        </p>
      )}
      <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {people.map((p) => {
          const fit = e.fit?.[p];
          const shared = new Set(e.sharedTags?.[p] ?? []);
          const theirs = (tastes[p] ?? []).slice(0, 4);
          return (
            <li key={p} className="rounded-xl bg-surface p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(p) }} />
                  {p}
                </span>
                {fit !== undefined && <span className="font-mono text-xs text-muted">{fit}/100</span>}
              </div>
              {fit !== undefined && (
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line">
                  <span className="bar-grow block h-full rounded-full" style={{ width: `${fit}%`, background: color(p) }} />
                </span>
              )}
              {!swapped && reasons[p] && <p className="mt-2 text-sm leading-snug">{reasons[p]}</p>}
              {(shared.size > 0 || theirs.length > 0) && (
                <p className="mt-2 text-xs text-muted">
                  {shared.size > 0 ? "Connects via " : "Their taste: "}
                  {(shared.size > 0 ? [...shared] : theirs).map((t) => (
                    <Chip key={t} active={shared.size > 0}>
                      {t}
                    </Chip>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Alternatives({
  current,
  alternatives,
  people,
  color,
  onSwap,
}: {
  current: PlanEntity;
  alternatives: Candidate[];
  people: string[];
  color: (n: string) => string;
  onSwap: (e: PlanEntity) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = alternatives.filter((c) => c.id !== current.id).slice(0, 5);
  if (!others.length) return null;

  return (
    <div className="mt-3">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
        {open ? "Hide" : "Compare with"} {others.length} other option{others.length === 1 ? "" : "s"} the agent considered
      </button>
      {open && (
        <ul className="rise mt-2 flex flex-col gap-1.5">
          {others.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line p-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.name}</span>
                {c.address && <span className="block truncate text-xs text-muted">{c.address}</span>}
              </span>
              <span className="flex items-end gap-1" aria-label="Fit per person">
                {people.map((p) => (
                  <span
                    key={p}
                    title={`${p}: ${c.fit[p] ?? "–"}`}
                    className="w-2 rounded-sm"
                    style={{ height: `${6 + (c.fit[p] ?? 0) * 0.18}px`, background: color(p) }}
                  />
                ))}
              </span>
              <span className="w-16 text-right font-mono text-xs text-muted">fair {c.groupScore}</span>
              <button
                onClick={() => {
                  onSwap(c);
                  setOpen(false);
                }}
                className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-ink/40"
              >
                Swap in
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Make each pick actionable.

function Actions({ entity: e, compact }: { entity: PlanEntity; compact?: boolean }) {
  const q = encodeURIComponent;
  const links: { label: string; href: string }[] = [];
  const where = [e.name, e.address ?? e.city].filter(Boolean).join(", ");
  switch (e.type) {
    case "urn:entity:place":
    case "urn:entity:destination":
      links.push({ label: "Directions", href: `https://www.google.com/maps/search/?api=1&query=${q(where)}` });
      if (e.url) links.push({ label: "Website", href: e.url });
      break;
    case "urn:entity:artist":
      links.push({ label: "Listen", href: `https://open.spotify.com/search/${q(e.name)}` });
      break;
    case "urn:entity:podcast":
      links.push({ label: "Listen", href: `https://open.spotify.com/search/${q(e.name)}/podcasts` });
      break;
    case "urn:entity:movie":
    case "urn:entity:tv_show":
      links.push({ label: "Trailer", href: `https://www.youtube.com/results?search_query=${q(`${e.name} trailer`)}` });
      links.push({ label: "Where to watch", href: `https://www.justwatch.com/us/search?q=${q(e.name)}` });
      break;
    case "urn:entity:book":
      links.push({ label: "Find the book", href: `https://www.goodreads.com/search?q=${q(e.name)}` });
      break;
    default:
      links.push({ label: "Look it up", href: `https://www.google.com/search?q=${q(where)}` });
  }
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "mt-2" : "mt-3"}`}>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-line px-3 py-1 text-xs font-medium transition hover:border-ink/40"
        >
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}

function ShareBar({ data }: { data: SharedPlan }) {
  const [note, setNote] = useState<string>();
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(undefined), 2200);
  };

  async function shareLink() {
    const url = `${location.origin}/#plan=${await encodePlan(data)}`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: data.plan.title, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    flash("Link copied: anyone with it sees this exact plan");
  }

  async function copyText() {
    await navigator.clipboard.writeText(`${planAsText(data)}\n\nPlanned with Common Ground: ${location.origin}`);
    flash("Plan copied as text");
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button onClick={shareLink} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-bg hover:opacity-90">
        Share plan
      </button>
      <button onClick={copyText} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
        Copy as text
      </button>
      <span role="status" className="text-xs text-muted">
        {note}
      </span>
    </div>
  );
}

function Chip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={`mr-1 mb-1 inline-block rounded-full px-2 py-0.5 ${
        active ? "bg-accent/15 font-medium text-ink ring-1 ring-accent/40" : "text-muted ring-1 ring-line"
      }`}
    >
      {children}
    </span>
  );
}

function alternativesFor(entityId: string, options: OptionList[]): Candidate[] {
  return options.find((o) => o.candidates.some((c) => c.id === entityId))?.candidates ?? [];
}

const eyebrow = "text-xs font-semibold tracking-wide text-muted uppercase";
