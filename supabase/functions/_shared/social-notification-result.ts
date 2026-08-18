export type SocialNotificationCounts = {
  sent: number;
  skipped: number;
  duplicates: number;
  retryable: number;
};

export function socialNotificationStatus(counts: SocialNotificationCounts): number {
  return counts.retryable > 0 ? 503 : 200;
}

// Only an explicit GoTrue rejection proves that the caller's token is bad.
// Missing server configuration, transport failures, throttling and upstream
// 5xx are operational failures and must remain retryable in the client outbox.
export function socialAuthFailureStatus(providerStatus: number | null, configured = true): number {
  if (!configured) return 503;
  return providerStatus === 401 || providerStatus === 403 ? 401 : 503;
}
