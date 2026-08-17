export type MedicationReminderEntry = {
  id: string;
  date: string | null;
  time: string | null;
  medication_name: string | null;
  schedule_slot_id: string | null;
  reminder_sent_at: string | null;
  reminder_count: number | null;
  snoozed_until: string | null;
};

export type ScheduledMedicationDose = {
  time: string;
  medicationName: string;
};

// Planned log rows are a client-side cache, not the schedule authority. A
// partial sync can leave an old row behind after a slot time/name changes.
// Filter through the live schedule and replace those cached fields before
// deciding whether a reminder is due.
export function canonicalMedicationReminderEntries(
  entries: MedicationReminderEntry[],
  scheduledDoses: Map<string, ScheduledMedicationDose>,
): MedicationReminderEntry[] {
  const canonical: MedicationReminderEntry[] = [];
  for (const entry of entries) {
    if (!entry.date || !entry.schedule_slot_id) continue;
    const scheduled = scheduledDoses.get(`${entry.date}_${entry.schedule_slot_id}`);
    if (!scheduled) continue;
    canonical.push({
      ...entry,
      time: scheduled.time,
      medication_name: scheduled.medicationName,
    });
  }
  return canonical;
}

export function medicationClaimedIds(value: unknown, allowedIds: Set<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') return null;
    const id = (row as { id: string }).id.trim();
    if (!id || !allowedIds.has(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
