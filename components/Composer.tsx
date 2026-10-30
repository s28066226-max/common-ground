"use client";

import { AGE_BUCKETS, type AgeBucket } from "@/lib/taxonomy";
import { AGE_LABELS, OCCASIONS, PERSON_COLORS, PRESETS, type Draft } from "./presets";

const BUDGETS = ["$", "$$", "$$$", "$$$$"] as const;

export function Composer({
  draft,
  setDraft,
  onSubmit,
  busy,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const updatePerson = (i: number, patch: Partial<Draft["people"][number]>) =>
    update({ people: draft.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const filled = draft.people.filter((p) => p.name.trim() && p.loves.trim().length > 1);
  const ready = filled.length >= 2 && draft.city.trim().length > 1 && !busy;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      <div>
        <Label>Start from an example</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              onClick={() => setDraft(structuredClone(p.draft))}
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-ink/40"
            >
              <div className="text-sm font-medium">{p.label}</div>
              <div className="text-xs text-muted">{p.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>The occasion</Label>
        <div className="flex flex-wrap gap-1.5">
          {OCCASIONS.map((o) => (
            <button
              type="button"
              key={o}
              onClick={() => update({ occasion: o })}
              aria-pressed={draft.occasion === o}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                draft.occasion === o ? "border-ink bg-ink text-bg" : "border-line bg-surface hover:border-ink/40"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="city">Where</Label>
          <input
            id="city"
            value={draft.city}
            onChange={(e) => update({ city: e.target.value })}
            placeholder="City or neighbourhood, e.g. Lisbon or Shoreditch"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Budget</Label>
          <div className="flex rounded-xl border border-line bg-surface p-1">
            {BUDGETS.map((b) => (
              <button
                type="button"
                key={b}
                onClick={() => update({ budget: draft.budget === b ? undefined : b })}
                aria-pressed={draft.budget === b}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  draft.budget === b ? "bg-ink text-bg" : "text-muted hover:text-ink"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label className="mb-0">Who&apos;s coming</Label>
          <span className="text-xs text-muted">Name a few things each person loves: bands, films, shows, books, food, brands.</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {draft.people.map((p, i) => (
            <div key={i} className="rise rounded-2xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PERSON_COLORS[i] }} />
                <input
                  value={p.name}
                  onChange={(e) => updatePerson(i, { name: e.target.value })}
                  placeholder={`Person ${i + 1}`}
                  aria-label={`Person ${i + 1} name`}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted"
                />
                <select
                  value={p.age ?? ""}
                  onChange={(e) => updatePerson(i, { age: (e.target.value || undefined) as AgeBucket | undefined })}
                  aria-label="Age range"
                  className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-muted outline-none"
                >
                  <option value="">Age</option>
                  {AGE_BUCKETS.map((a) => (
                    <option key={a} value={a}>
                      {AGE_LABELS[a]}
                    </option>
                  ))}
                </select>
                {draft.people.length > 2 && (
                  <button
                    type="button"
                    onClick={() => update({ people: draft.people.filter((_, j) => j !== i) })}
                    aria-label={`Remove ${p.name || `person ${i + 1}`}`}
                    className="rounded-lg px-2 py-1 text-muted hover:text-ink"
                  >
                    ×
                  </button>
                )}
              </div>
              <textarea
                value={p.loves}
                onChange={(e) => updatePerson(i, { loves: e.target.value })}
                placeholder="e.g. Radiohead, Past Lives, The Bear, ramen, Patagonia"
                rows={2}
                aria-label={`What ${p.name || `person ${i + 1}`} loves`}
                className="mt-2 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted/70"
              />
            </div>
          ))}
        </div>
        {draft.people.length < 6 && (
          <button
            type="button"
            onClick={() => update({ people: [...draft.people, { name: "", loves: "" }] })}
            className="mt-2.5 w-full rounded-2xl border border-dashed border-line py-2.5 text-sm text-muted transition hover:border-ink/40 hover:text-ink"
          >
            + Add someone
          </button>
        )}
      </div>

      <div>
        <Label htmlFor="notes">Anything else? (optional)</Label>
        <input
          id="notes"
          value={draft.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Dietary needs, accessibility, time of day…"
          className={inputCls}
        />
      </div>

      <button
        type="submit"
        disabled={!ready}
        className="rounded-2xl bg-accent px-5 py-3.5 text-base font-semibold text-accent-ink shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Finding your common ground…" : "Find our common ground"}
      </button>
    </form>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none transition placeholder:text-muted/70 focus:border-ink/50";

function Label({ children, htmlFor, className = "" }: { children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={`mb-2 block text-xs font-semibold tracking-wide text-muted uppercase ${className}`}>
      {children}
    </label>
  );
}
