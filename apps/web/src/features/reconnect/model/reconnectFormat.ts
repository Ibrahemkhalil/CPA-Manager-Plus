import type { ReconnectProvider } from '@/services/api/reconnect';

export const PROVIDER_LABELS: Record<ReconnectProvider, string> = {
  claude: 'Claude',
  codex: 'ChatGPT (Codex)',
  antigravity: 'Antigravity',
  xai: 'xAI (Grok)',
  meta: 'Muse (Meta)',
};

export const providerLabel = (provider: string): string =>
  PROVIDER_LABELS[provider as ReconnectProvider] ?? provider;

// What differs on the public page between login types. Device logins (xAI,
// Meta) are approved on the provider's site; nothing is pasted back.
export interface ProviderFlow {
  site: string;
  approve: string;
  callback: string;
  device: boolean;
}

export const PROVIDER_FLOWS: Record<ReconnectProvider, ProviderFlow> = {
  claude: {
    site: 'Claude',
    approve: 'Authorize',
    callback: 'http://localhost:54545/callback',
    device: false,
  },
  codex: {
    site: 'ChatGPT',
    approve: 'Continue',
    callback: 'http://localhost:1455/auth/callback',
    device: false,
  },
  antigravity: {
    site: 'Google',
    approve: 'Allow',
    callback: 'http://localhost:51121/oauth-callback',
    device: false,
  },
  xai: { site: 'xAI', approve: 'Approve', callback: '', device: true },
  meta: { site: 'Meta', approve: 'Approve', callback: '', device: true },
};

export const providerFlow = (provider: string): ProviderFlow =>
  PROVIDER_FLOWS[provider as ReconnectProvider] ?? PROVIDER_FLOWS.claude;

/** "3d 4h", "4h 26m", "12m 5s": the two largest units of a duration. */
export const formatWaiting = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const parts: Array<[number, string]> = [
    [Math.floor(s / 86400), 'd'],
    [Math.floor((s % 86400) / 3600), 'h'],
    [Math.floor((s % 3600) / 60), 'm'],
    [s % 60, 's'],
  ];
  const first = parts.findIndex(([value]) => value > 0);
  if (first === -1) return '0s';
  return parts
    .slice(first, first + 2)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
};

/** m:ss countdown. */
export const formatCountdown = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Every IANA time zone the browser knows, UTC first. */
export const timeZoneOptions = (): string[] => {
  // Intl.supportedValuesOf is ES2022; older lib typings do not declare it.
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[] = [];
  try {
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
};

/** Date and time in the given zone, e.g. 2026-10-03 11:52. */
export const formatInZone = (ms: number | undefined, timeZone: string): string => {
  if (!ms) return '-';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(ms))
      .replace(',', '');
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
};
