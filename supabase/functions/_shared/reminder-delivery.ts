export type ReminderDeliveryKind = 'generic' | 'water' | 'daily-log';

type DbFetch = (path: string, options?: RequestInit) => Promise<Response>;

export type ReminderClaim = {
  eventKey: string;
  token: string;
};

function scalarText(value: unknown, functionName: string): string | null {
  if (typeof value === 'string') return value || null;
  if (Array.isArray(value) && value.length === 1) {
    const row = value[0];
    if (typeof row === 'string') return row || null;
    if (row && typeof row === 'object') {
      const nested = (row as Record<string, unknown>)[functionName];
      return typeof nested === 'string' && nested ? nested : null;
    }
  }
  if (value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>)[functionName];
    return typeof nested === 'string' && nested ? nested : null;
  }
  return null;
}

function scalarBoolean(value: unknown, functionName: string): boolean {
  if (value === true) return true;
  if (Array.isArray(value) && value.length === 1) {
    const row = value[0];
    if (row === true) return true;
    if (row && typeof row === 'object') return (row as Record<string, unknown>)[functionName] === true;
  }
  return !!value && typeof value === 'object'
    && (value as Record<string, unknown>)[functionName] === true;
}

export async function claimReminderDelivery(
  dbFetch: DbFetch,
  args: {
    kind: ReminderDeliveryKind;
    userId: string;
    claimedAt: string;
    expectedAt?: string | null;
    expectedText?: string | null;
    targetText?: string | null;
  },
): Promise<ReminderClaim | null> {
  const token = crypto.randomUUID();
  const response = await dbFetch('rpc/claim_reminder_delivery', {
    method: 'POST',
    body: JSON.stringify({
      p_kind: args.kind,
      p_user_id: args.userId,
      p_expected_at: args.expectedAt ?? null,
      p_expected_text: args.expectedText ?? null,
      p_target_text: args.targetText ?? null,
      p_claim_token: token,
      p_claimed_at: args.claimedAt,
    }),
  });
  if (!response.ok) {
    throw new Error(`reminder claim failed (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const eventKey = scalarText(await response.json().catch(() => null), 'claim_reminder_delivery');
  return eventKey ? { eventKey, token } : null;
}

export async function finishReminderDelivery(
  dbFetch: DbFetch,
  args: {
    kind: ReminderDeliveryKind;
    userId: string;
    claim: ReminderClaim;
    delivered: boolean;
  },
): Promise<boolean> {
  const response = await dbFetch('rpc/finish_reminder_delivery', {
    method: 'POST',
    body: JSON.stringify({
      p_kind: args.kind,
      p_user_id: args.userId,
      p_event_key: args.claim.eventKey,
      p_claim_token: args.claim.token,
      p_delivered: args.delivered,
    }),
  });
  if (!response.ok) {
    throw new Error(`reminder finish failed (${response.status}): ${await response.text().catch(() => '')}`);
  }
  return scalarBoolean(await response.json().catch(() => null), 'finish_reminder_delivery');
}

export async function pruneReminderDeliveries(
  dbFetch: DbFetch,
  limit = 500,
): Promise<number> {
  const response = await dbFetch('rpc/prune_reminder_delivery_claims', {
    method: 'POST',
    body: JSON.stringify({ p_limit: limit }),
  });
  if (!response.ok) {
    throw new Error(`reminder retention failed (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const value = await response.json().catch(() => 0);
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.length === 1) {
    const row = value[0];
    if (typeof row === 'number') return row;
    if (row && typeof row === 'object') {
      const nested = (row as Record<string, unknown>).prune_reminder_delivery_claims;
      return typeof nested === 'number' ? nested : 0;
    }
  }
  if (value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>).prune_reminder_delivery_claims;
    return typeof nested === 'number' ? nested : 0;
  }
  return 0;
}
