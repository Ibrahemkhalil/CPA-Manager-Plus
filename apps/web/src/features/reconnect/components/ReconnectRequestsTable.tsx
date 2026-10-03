import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import {
  reconnectApi,
  reconnectErrorMessage,
  type ReconnectOutage,
  type ReconnectStatus,
} from '@/services/api/reconnect';
import { formatInZone, formatWaiting, providerLabel } from '../model/reconnectFormat';
import styles from './ReconnectSettingsSection.module.scss';

type Filter = ReconnectStatus | 'all';

const DAY_SECONDS = 86400;

interface Props {
  base: string;
  managementKey: string;
  timeZone: string;
  /** Bumped by the parent after sending a link, to refresh at once. */
  version: number;
}

/** Reconnect requests of the last 30 days; refreshes every minute. */
export function ReconnectRequestsTable({ base, managementKey, timeZone, version }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReconnectOutage[]>([]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    try {
      setRows(await reconnectApi.listRequests(base, managementKey));
      setError('');
    } catch (err) {
      setError(reconnectErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [base, managementKey]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(refresh);
  }, [load, version]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const labels: Record<Filter, string> = {
    pending: t('reconnect.status_pending', { defaultValue: 'Waiting' }),
    completed: t('reconnect.status_completed', { defaultValue: 'Reconnected' }),
    resolved: t('reconnect.status_resolved', { defaultValue: 'Recovered' }),
    expired: t('reconnect.status_expired', { defaultValue: 'Not used' }),
    all: t('reconnect.status_all', { defaultValue: 'All' }),
  };
  const filters: Filter[] = ['pending', 'completed', 'resolved', 'expired', 'all'];
  const visible = filter === 'all' ? rows : rows.filter((row) => row.status === filter);
  const count = (f: Filter) =>
    f === 'all' ? rows.length : rows.filter((row) => row.status === f).length;

  // When the clock stops: waiting -> now, otherwise when it was closed.
  const waitedSeconds = (row: ReconnectOutage) => {
    const end = row.status === 'pending' ? now : row.closedAtMs || row.lastMessageAtMs;
    return (end - row.firstNotifiedAtMs) / 1000;
  };

  return (
    <div className={styles.group}>
      <div className={styles.actions}>
        <h4 className={styles.groupTitle}>
          {t('reconnect.requests_title', { defaultValue: 'Reconnect requests' })}
        </h4>
        <span className={styles.muted}>
          {t('reconnect.requests_hint', {
            defaultValue: 'Last 30 days. Times in {{timeZone}}.',
            timeZone,
          })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <IconRefreshCw size={14} />
          {t('reconnect.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>
      <SegmentedTabs<Filter>
        items={filters.map((f) => ({ id: f, label: `${labels[f]} ${count(f)}` }))}
        activeTab={filter}
        onChange={setFilter}
        ariaLabel={t('reconnect.filter', { defaultValue: 'Filter by status' })}
      />
      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('reconnect.col_email', { defaultValue: 'Email' })}</th>
              <th>{t('reconnect.col_login', { defaultValue: 'Login' })}</th>
              {filter === 'all' ? (
                <th>{t('reconnect.col_status', { defaultValue: 'Status' })}</th>
              ) : null}
              <th>{t('reconnect.col_waiting', { defaultValue: 'Waiting for' })}</th>
              <th>{t('reconnect.col_first', { defaultValue: 'First notified' })}</th>
              <th>{t('reconnect.col_reminders', { defaultValue: 'Reminders' })}</th>
              <th>
                {filter === 'pending'
                  ? t('reconnect.col_expires', { defaultValue: 'Link expires' })
                  : t('reconnect.col_closed', { defaultValue: 'Closed' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={filter === 'all' ? 7 : 6}>
                  {t('reconnect.empty', { defaultValue: 'Nothing here.' })}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const waited = waitedSeconds(row);
                const live = row.status === 'pending';
                return (
                  <tr key={row.id}>
                    <td>
                      {row.email}
                      {row.manual ? (
                        <span className={styles.muted}>
                          {' '}
                          {t('reconnect.sent_by_admin', { defaultValue: '(sent by admin)' })}
                        </span>
                      ) : null}
                    </td>
                    <td>{providerLabel(row.provider)}</td>
                    {filter === 'all' ? <td>{labels[row.status]}</td> : null}
                    <td
                      className={[
                        styles.waiting,
                        live && waited >= DAY_SECONDS ? styles.waitingLong : '',
                        live ? '' : styles.muted,
                      ].join(' ')}
                    >
                      {formatWaiting(waited)}
                    </td>
                    <td>{formatInZone(row.firstNotifiedAtMs, timeZone)}</td>
                    <td>{row.reminders}</td>
                    <td>{formatInZone(live ? row.expiresAtMs : row.closedAtMs, timeZone)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
