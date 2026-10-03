import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { usePanelFeatureAvailability } from '@/hooks/usePanelFeatureAvailability';
import {
  RECONNECT_PROVIDERS,
  reconnectApi,
  reconnectErrorMessage,
  type ReconnectProvider,
  type ReconnectSettings,
  type ReconnectSummary,
} from '@/services/api/reconnect';
import { useAuthStore, useNotificationStore } from '@/stores';
import { providerLabel, timeZoneOptions } from '../model/reconnectFormat';
import { ReconnectRequestsTable } from './ReconnectRequestsTable';
import styles from './ReconnectSettingsSection.module.scss';

const toInt = (value: string) => Number.parseInt(value, 10) || 0;

/**
 * Self-service reconnect settings (Manager Server). When a subscription login
 * in CPA can only recover through a new OAuth login, its owner is messaged a
 * one-time link through the notification webhook and reconnects it.
 */
export function ReconnectSettingsSection() {
  const { t } = useTranslation();
  const managementKey = useAuthStore((state) => state.managementKey);
  const { showNotification } = useNotificationStore();
  const base = usePanelFeatureAvailability().managerServiceBase;

  const [form, setForm] = useState<ReconnectSettings | null>(null);
  const [saved, setSaved] = useState<ReconnectSettings | null>(null);
  const [webhookDraft, setWebhookDraft] = useState('');
  const [summary, setSummary] = useState<ReconnectSummary[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testProvider, setTestProvider] = useState<ReconnectProvider>('claude');
  const [testEmail, setTestEmail] = useState('');
  const [tableVersion, setTableVersion] = useState(0);
  const zones = useMemo(() => timeZoneOptions(), []);

  const load = useCallback(async () => {
    if (!base || !managementKey) return;
    setLoadError('');
    try {
      const settings = await reconnectApi.getSettings(base, managementKey);
      setForm(settings);
      setSaved(settings);
      setWebhookDraft('');
      setSummary(await reconnectApi.getSummary(base, managementKey).catch(() => []));
    } catch (error) {
      setLoadError(reconnectErrorMessage(error));
    }
  }, [base, managementKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof ReconnectSettings>(key: K, value: ReconnectSettings[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const save = async () => {
    if (!form || !base) return;
    setSaving(true);
    try {
      const next = await reconnectApi.updateSettings(base, managementKey, {
        ...form,
        webhookUrl: webhookDraft.trim(),
      });
      setForm(next);
      setSaved(next);
      setWebhookDraft('');
      showNotification(
        t('reconnect.saved', { defaultValue: 'Self-service reconnect settings saved' }),
        'success'
      );
    } catch (error) {
      showNotification(reconnectErrorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!base) return;
    const email = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showNotification(
        t('reconnect.invalid_email', { defaultValue: 'Enter a valid email address' }),
        'error'
      );
      return;
    }
    setSending(true);
    try {
      const result = await reconnectApi.send(base, managementKey, testProvider, email);
      if (!result.sent) {
        showNotification(
          result.notice ?? t('reconnect.nothing_sent', { defaultValue: 'Nothing was sent.' }),
          'info',
          10000
        );
      } else {
        const message =
          result.purpose === 'test'
            ? t('reconnect.sent_test', {
                defaultValue: 'Test link sent to {{email}} (their login works)',
                email,
              })
            : result.purpose === 'invite'
              ? t('reconnect.sent_invite', {
                  defaultValue: 'Invitation sent to {{email}} (no login of this type yet)',
                  email,
                })
              : t('reconnect.sent_reconnect', {
                  defaultValue: 'Reconnect link sent to {{email}}',
                  email,
                });
        showNotification(message, 'success');
        setTestEmail('');
        setTableVersion((v) => v + 1);
      }
    } catch (error) {
      showNotification(reconnectErrorMessage(error), 'error');
    } finally {
      setSending(false);
    }
  };

  const hourOptions = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      value: String(from + i),
      label: `${from + i}:00`,
    }));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderText}>
          <h3 className={styles.sectionTitle}>
            {t('reconnect.section_title', { defaultValue: 'Self-service reconnect' })}
          </h3>
          <p className={styles.hint}>
            {t('reconnect.section_hint', {
              defaultValue:
                'When a Claude, Codex, Antigravity, xAI or Muse login can only recover through a new sign-in, its owner (matched by the login email) gets a one-time link and reconnects it themselves.',
            })}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={saving}>
          <IconRefreshCw size={14} />
          {t('reconnect.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {loadError ? (
        <div className={styles.errorBanner} role="alert">
          <strong>{t('reconnect.load_failed', { defaultValue: 'Load failed' })}</strong>
          <span>{loadError}</span>
        </div>
      ) : null}

      {form ? (
        <>
          <ToggleSwitch
            checked={form.enabled}
            onChange={(value) => update('enabled', value)}
            label={t('reconnect.enabled', { defaultValue: 'Enable self-service reconnect' })}
          />

          {summary.some((item) => item.logins > 0) ? (
            <div className={styles.summary}>
              {summary
                .filter((item) => item.logins > 0)
                .map((item) => (
                  <span className={styles.summaryItem} key={item.provider}>
                    {providerLabel(item.provider)}: {item.logins}
                    {item.needingReconnect > 0 ? (
                      <span className={styles.summaryBroken}>
                        {' '}
                        ·{' '}
                        {t('reconnect.summary_broken', {
                          defaultValue: '{{count}} need reconnecting',
                          count: item.needingReconnect,
                        })}
                      </span>
                    ) : null}
                  </span>
                ))}
            </div>
          ) : null}

          {form.enabled ? (
            <>
              <div className={styles.grid}>
                <Input
                  label={t('reconnect.public_url', { defaultValue: 'Public panel URL' })}
                  hint={t('reconnect.public_url_hint', {
                    defaultValue:
                      'Where people open this panel; links point to {{url}}/management.html#/reconnect/…',
                    url: form.publicUrl || 'https://cpamp.example.com',
                  })}
                  placeholder="https://cpamp.example.com"
                  value={form.publicUrl}
                  onChange={(event) => update('publicUrl', event.target.value)}
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  label={t('reconnect.webhook_url', { defaultValue: 'Notification webhook URL' })}
                  hint={
                    saved?.webhookConfigured
                      ? t('reconnect.webhook_configured', {
                          defaultValue:
                            'Saved. Leave blank to keep it, or enter a new URL to replace it.',
                        })
                      : t('reconnect.webhook_hint', {
                          defaultValue:
                            'Receives one POST per message with sendTo (email) and body (HTML), e.g. a Teams Power Automate flow or a Slack workflow.',
                        })
                  }
                  placeholder="https://"
                  value={webhookDraft}
                  onChange={(event) => setWebhookDraft(event.target.value)}
                />
                <Input
                  label={t('reconnect.sender_name', { defaultValue: 'Sender name' })}
                  hint={t('reconnect.sender_name_hint', {
                    defaultValue: 'Shown in messages, e.g. “connected to CPA Manager Plus”.',
                  })}
                  value={form.senderName}
                  onChange={(event) => update('senderName', event.target.value)}
                />
                <Input
                  type="number"
                  min={1}
                  max={60}
                  label={t('reconnect.check_interval', {
                    defaultValue: 'Check interval (minutes)',
                  })}
                  hint={t('reconnect.check_interval_hint', {
                    defaultValue:
                      '1–60. Owners are messaged after a login stays broken for 10 minutes.',
                  })}
                  value={String(form.checkIntervalMinutes)}
                  onChange={(event) => update('checkIntervalMinutes', toInt(event.target.value))}
                />
                <Input
                  type="number"
                  min={1}
                  max={72}
                  label={t('reconnect.link_ttl', { defaultValue: 'Link lifetime (hours)' })}
                  hint={t('reconnect.link_ttl_hint', {
                    defaultValue: '1–72. When a link expires, a reminder replaces it.',
                  })}
                  value={String(form.linkTtlHours)}
                  onChange={(event) => update('linkTtlHours', toInt(event.target.value))}
                />
              </div>

              <div className={styles.group}>
                <h4 className={styles.groupTitle}>
                  {t('reconnect.reminders', { defaultValue: 'Reminders' })}
                </h4>
                <p className={styles.hint}>
                  {t('reconnect.reminders_hint', {
                    defaultValue:
                      'Owners who have not reconnected get a reminder with a fresh link every 1–6 hours, only between these hours.',
                  })}
                </p>
                <div className={styles.reminderGrid}>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    label={t('reconnect.followup_every', { defaultValue: 'Every (hours)' })}
                    value={String(form.followupHours)}
                    onChange={(event) => update('followupHours', toInt(event.target.value))}
                  />
                  <label className={styles.fieldLabel}>
                    {t('reconnect.from_hour', { defaultValue: 'From' })}
                    <Select
                      value={String(form.followupStartHour)}
                      options={hourOptions(0, 23)}
                      onChange={(value) => update('followupStartHour', toInt(value))}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {t('reconnect.until_hour', { defaultValue: 'Until' })}
                    <Select
                      value={String(form.followupEndHour)}
                      options={hourOptions(1, 24)}
                      onChange={(value) => update('followupEndHour', toInt(value))}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {t('reconnect.time_zone', { defaultValue: 'Time zone' })}
                    <Select
                      value={form.followupTimeZone}
                      options={zones.map((zone) => ({ value: zone, label: zone }))}
                      onChange={(value) => update('followupTimeZone', value)}
                    />
                  </label>
                </div>
              </div>
            </>
          ) : null}

          <div className={styles.actions}>
            <Button onClick={() => void save()} loading={saving}>
              {t('reconnect.save', { defaultValue: 'Save' })}
            </Button>
          </div>

          {saved?.enabled ? (
            <>
              <div className={styles.group}>
                <h4 className={styles.groupTitle}>
                  {t('reconnect.send_title', { defaultValue: 'Send a link' })}
                </h4>
                <div className={styles.sendRow}>
                  <Select
                    value={testProvider}
                    options={RECONNECT_PROVIDERS.map((provider) => ({
                      value: provider,
                      label: providerLabel(provider),
                    }))}
                    onChange={(value) => setTestProvider(value as ReconnectProvider)}
                    ariaLabel={t('reconnect.login_type', { defaultValue: 'Login type' })}
                  />
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    aria-label={t('reconnect.email', { defaultValue: 'Email' })}
                    value={testEmail}
                    onChange={(event) => setTestEmail(event.target.value)}
                  />
                  <Button variant="secondary" onClick={() => void sendTest()} loading={sending}>
                    {t('reconnect.send', { defaultValue: 'Send' })}
                  </Button>
                </div>
                <p className={styles.hint}>
                  {t('reconnect.send_hint', {
                    defaultValue:
                      'Working login: a test link. No login: an invitation. Broken login: a reconnect request, or nothing if they were already notified.',
                  })}
                </p>
              </div>
              <ReconnectRequestsTable
                base={base}
                managementKey={managementKey}
                timeZone={saved.followupTimeZone}
                version={tableVersion}
              />
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
