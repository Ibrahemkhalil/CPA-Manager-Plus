import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatInZone,
  formatWaiting,
  providerFlow,
  providerLabel,
  timeZoneOptions,
} from './reconnectFormat';

describe('reconnectFormat', () => {
  it('shows the two largest units of a wait', () => {
    expect(formatWaiting(0)).toBe('0s');
    expect(formatWaiting(65)).toBe('1m 5s');
    expect(formatWaiting(4 * 3600 + 26 * 60 + 9)).toBe('4h 26m');
    expect(formatWaiting(8 * 86400 + 12 * 3600)).toBe('8d 12h');
  });

  it('formats a countdown', () => {
    expect(formatCountdown(281)).toBe('4:41');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it('describes providers and their flows', () => {
    expect(providerLabel('codex')).toBe('ChatGPT (Codex)');
    expect(providerLabel('unknown')).toBe('unknown');
    expect(providerFlow('xai').device).toBe(true);
    expect(providerFlow('antigravity').callback).toContain('51121');
    expect(providerFlow('nope').site).toBe('Claude');
  });

  it('lists UTC first and formats times in a zone', () => {
    expect(timeZoneOptions()[0]).toBe('UTC');
    expect(formatInZone(Date.UTC(2026, 9, 3, 5, 0), 'Asia/Tokyo')).toBe('2026-10-03 14:00');
    expect(formatInZone(0, 'UTC')).toBe('-');
  });
});
