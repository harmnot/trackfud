/**
 * Settings editor (A9, PLAN §4.4 P0): per-scope overrides of `config.yaml`.
 * Scope picker (Global + per-country), grouped numeric editors with the
 * registry range as hint, save-per-key with client + server validation, and
 * clear-to-default. Every row shows the effective value the backend serves
 * (also visible to couriers/merchants via `GET /v1/config/public`).
 *
 * Responsive: group sections stack in the shared `tb-grid-2`; rows collapse
 * to one column on phones.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { Button, Dropdown, Item, List, Note, Page } from '../../components/ui';
import { fetchSettings, saveSetting } from './api';
import { groupSettings, SETTING_SCOPES, settingError, type SettingItem } from './types';

export function SettingsPage() {
  const [scope, setScope] = useState('global');
  const q = useQuery({
    queryKey: ['admin', 'settings', scope],
    queryFn: () => fetchSettings(scope),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
  const settings = q.data ?? [];
  const groups = groupSettings(settings);

  return (
    <Page>
      <h1 className="tb-display">Settings</h1>
      <p className="tb-sub">
        Overrides of <code>config.yaml</code> — fitness tests, dispatch corridors, order windows,
        fees, health goals. Saved values apply without a restart; clearing returns to the default.
        Every change is audit-logged.
      </p>

      <div className="tb-toolbar">
        <Dropdown
          label="Settings scope"
          value={scope}
          options={SETTING_SCOPES.map((s) => ({ value: s, label: s === 'global' ? 'Global' : `Country ${s}` }))}
          onChange={setScope}
        />
        <span className="tb-count">{settings.length} shown</span>
      </div>

      {q.isLoading && (
        <List>
          {[0, 1, 2].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 120 }} />
            </Item>
          ))}
        </List>
      )}
      {q.isError && (
        <Note tone="error">
          Could not load settings ({q.error instanceof Error ? q.error.message : 'unknown error'}).{' '}
          <button className="tb-link" onClick={() => void q.refetch()}>
            Retry
          </button>
        </Note>
      )}
      {!q.isLoading && !q.isError && settings.length === 0 && <Note tone="info">No editable settings on this backend yet.</Note>}
      <div className="tb-grid-2 mt-3">
        {groups.map((g) => (
          <section key={g.group} className="tb-card" aria-label={`${g.group} settings`}>
            <h2 className="tb-h2" style={{ textTransform: 'capitalize' }}>
              {g.group}
            </h2>
            <div style={{ display: 'grid', gap: '1rem', marginTop: '0.75rem' }}>
              {g.items.map((s) => (
                // Key on scope so switching Global ↔ country resets drafts.
                <SettingRow key={`${scope}:${s.key}`} item={s} scope={scope} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

function SettingRow({ item, scope }: { item: SettingItem; scope: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(item.override === null ? '' : String(item.override));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const edited = draft.trim() !== (item.override === null ? '' : String(item.override));

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
  }

  async function onSave() {
    setErr('');
    setDone('');
    const problem = settingError(item, draft);
    if (problem !== '') {
      setErr(problem);
      return;
    }
    setBusy(true);
    try {
      // Server is the decider: unknown keys and out-of-range values 400.
      await saveSetting({ scope, key: item.key, value: Number(draft.trim()) });
      setDone(`Saved — effective value is now ${draft.trim()}.`);
      await refresh();
    } catch (e) {
      logger.warn('setting save failed', {});
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setErr('');
    setDone('');
    setBusy(true);
    try {
      await saveSetting({ scope, key: item.key, value: null });
      setDraft('');
      setDone(`Cleared — back to the default (${item.is_default}).`);
      await refresh();
    } catch (e) {
      logger.warn('setting clear failed', {});
      setErr(e instanceof Error ? e.message : 'Clear failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label>
        <span className="tb-label">{item.label}</span>
        <input
          className="tb-input"
          value={draft}
          inputMode="decimal"
          placeholder={`default ${item.is_default}`}
          aria-label={`${item.label} (${item.min} to ${item.max})`}
          onChange={(e) => {
            setDraft(e.target.value);
            setErr('');
            setDone('');
          }}
        />
      </label>
      <p className="tb-sub tb-tight">
        Range {item.min} – {item.max}
        {item.hint !== '' ? ` · ${item.hint}` : ''} · effective <strong>{item.effective}</strong>
        {item.override === null ? ' (default)' : ' (override)'}
      </p>
      <div className="tb-actions">
        <Button variant="clay" small disabled={busy || !edited} onClick={() => void onSave()}>
          {busy ? '…' : 'Save'}
        </Button>
        {item.override !== null && (
          <Button variant="soft" small disabled={busy} onClick={() => void onClear()}>
            {busy ? '…' : 'Clear to default'}
          </Button>
        )}
      </div>
      {err !== '' && (
        <div className="mt-2">
          <Note tone="error">{err}</Note>
        </div>
      )}
      {done !== '' && (
        <div className="mt-2">
          <Note tone="info">{done}</Note>
        </div>
      )}
    </div>
  );
}
