import { apiDelete, apiGet, apiPost, apiPut } from './api';

// Web push in the browser. Imported only by the push components, which live in lazy route chunks,
// so none of it is in the entry bundle. Nothing here asks the browser for permission until
// enablePush() is called from a click.

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}
export type PushCategory = 'urgent' | 'messages' | 'bookings';
export type PushPreferences = Record<PushCategory, boolean>;
export interface PushPreferencesResponse {
  preferences: PushPreferences;
  devices: number;
}

/** What this browser can do, in the order the UI cares about. */
export type PushSupport = 'ready' | 'blocked' | 'needs-install' | 'unsupported';

let configPromise: Promise<PushConfig> | null = null;

/** The server's push config; a failed request counts as "off" so the feature stays hidden. */
export function getPushConfig(): Promise<PushConfig> {
  configPromise ??= apiGet<PushConfig>('/push/config', { skipAuthRedirect: true }).catch(() => ({
    enabled: false,
    publicKey: null,
  }));
  return configPromise;
}

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const hasPushApis = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function pushSupport(): PushSupport {
  // iOS Safari only offers push to a site added to the home screen.
  if (isIos() && !isInstalled()) return 'needs-install';
  if (!hasPushApis()) return 'unsupported';
  return Notification.permission === 'denied' ? 'blocked' : 'ready';
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** True when this browser already has a push subscription for MusiLynk. */
export async function isSubscribedHere(): Promise<boolean> {
  if (!hasPushApis()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

function keyBytes(base64Url: string) {
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export type EnableResult = 'enabled' | 'denied' | 'unavailable';

/** Asks for permission (call from a click), subscribes this browser and tells the server. */
export async function enablePush(): Promise<EnableResult> {
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey || !hasPushApis()) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  await registration();
  const reg = await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) }));
  await apiPost('/push/subscriptions', subscription.toJSON());
  return 'enabled';
}

/** Removes this browser's subscription on the server, then in the browser. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await apiDelete('/push/subscriptions', { body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await subscription.unsubscribe();
}

export const getPushPreferences = () => apiGet<PushPreferencesResponse>('/push/preferences');
export const savePushPreferences = (preferences: Partial<PushPreferences>) =>
  apiPut<PushPreferencesResponse>('/push/preferences', { preferences });
