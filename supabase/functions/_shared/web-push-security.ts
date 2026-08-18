export function isAllowedWebPushEndpoint(value: string): boolean {
  try {
    if (!value || value.length > 2048 || /\s/.test(value)) return false;
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:' || (endpoint.port && endpoint.port !== '443')) return false;
    const host = endpoint.hostname.toLowerCase();
    return host === 'fcm.googleapis.com'
      || host === 'updates.push.services.mozilla.com'
      || host === 'push.services.mozilla.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.push.apple.com')
      || host.endsWith('.notify.windows.com');
  } catch (_) {
    return false;
  }
}
