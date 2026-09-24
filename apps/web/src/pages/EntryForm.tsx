import { useState } from "react";
import type { EventInfo } from "../api";
import { Button, ErrorBox, Field, Input, Select } from "../ui";

export interface EntryDraft {
  firstName: string;
  lastName: string;
  team: string;
  birthYear?: number | null;
  gender?: "boys" | "girls" | null;
  divisionId?: string | null;
  weightClass?: string | null;
  declaredWeight?: number | null;
  contactEmail?: string | null;
}

/** Register a wrestler. Used by the director (Wrestlers tab) and by parents/coaches (public page). */
export function EntryForm({
  event,
  onSubmit,
  pending,
  error,
  askEmail = false,
  submitLabel = "Add wrestler",
}: {
  event: EventInfo;
  onSubmit: (draft: EntryDraft) => void;
  pending: boolean;
  error: unknown;
  askEmail?: boolean;
  submitLabel?: string;
}) {
  const [d, setD] = useState<EntryDraft>({ firstName: "", lastName: "", team: "", gender: null, divisionId: null });
  const set = (patch: Partial<EntryDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const youth = event.format === "madison";
  const division = event.divisions.find((x) => x.id === d.divisionId);
  const genders = new Set(event.divisions.map((x) => x.gender));
  const valid =
    d.firstName.trim() &&
    d.lastName.trim() &&
    (youth ? d.birthYear && (d.gender || genders.has("mixed")) : d.divisionId && d.weightClass);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          ...d,
          gender: d.gender ?? (youth && genders.has("mixed") ? "boys" : null),
          declaredWeight: d.declaredWeight || null,
          contactEmail: d.contactEmail || null,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input value={d.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Last name">
          <Input value={d.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="off" />
        </Field>
      </div>
      <Field label="Team or club">
        <Input value={d.team} onChange={(e) => set({ team: e.target.value })} placeholder="e.g. Springfield Youth Wrestling" />
      </Field>

      {youth ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Birth year" hint={`Used to find the age group (season ${event.seasonYear}).`}>
            <Input
              type="number"
              inputMode="numeric"
              min={1990}
              max={event.seasonYear}
              value={d.birthYear ?? ""}
              onChange={(e) => set({ birthYear: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
          {!genders.has("mixed") && (
            <Field label="Division">
              <Select value={d.gender ?? ""} onChange={(e) => set({ gender: (e.target.value || null) as EntryDraft["gender"] })}>
                <option value="">Choose…</option>
                {genders.has("boys") && <option value="boys">Boys</option>}
                {genders.has("girls") && <option value="girls">Girls</option>}
              </Select>
            </Field>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Division">
            <Select value={d.divisionId ?? ""} onChange={(e) => set({ divisionId: e.target.value || null, weightClass: null })}>
              <option value="">Choose…</option>
              {event.divisions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Weight class">
            <Select value={d.weightClass ?? ""} onChange={(e) => set({ weightClass: e.target.value || null })} disabled={!division}>
              <option value="">Choose…</option>
              {division?.weightClasses?.map((w) => (
                <option key={w} value={String(w)}>
                  {w}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Field label="Approximate weight (lb)" hint="Optional. The official weight is taken at weigh-ins.">
        <Input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={d.declaredWeight ?? ""}
          onChange={(e) => set({ declaredWeight: e.target.value ? Number(e.target.value) : null })}
        />
      </Field>
      {askEmail && (
        <Field label="Parent or coach email" hint="Optional. For updates about this tournament only.">
          <Input type="email" value={d.contactEmail ?? ""} onChange={(e) => set({ contactEmail: e.target.value })} />
        </Field>
      )}
      <ErrorBox error={error} />
      <Button type="submit" disabled={!valid || pending} className="w-full sm:w-auto">
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
