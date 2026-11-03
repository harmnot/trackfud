import { Fragment, useState } from 'react';
import { Button, Field, Note, Select, TextInput } from '../../components/ui';
import { formatValue } from '../../lib/format';
import type { Sanction } from '../../lib/types';
import type { SanctionInput } from './review';

/** Humanize a sanction kind for the Action picker (Freeze, Unfreeze, …). */
export function sanctionLabel(kind: string): string {
  const word = kind.replace(/_/g, ' ').trim();
  return word === '' ? kind : word.slice(0, 1).toUpperCase() + word.slice(1);
}

/** Ban/freeze panel: kind + audit reason, then the recorded sanction history. */
export function SanctionBox({
  kinds,
  history,
  busy,
  err,
  done,
  showEndsAt,
  onSanction,
}: {
  kinds: string[];
  history: Sanction[];
  busy: boolean;
  err: string;
  done: string;
  showEndsAt: boolean;
  onSanction: (input: SanctionInput) => void;
}) {
  const [kind, setKind] = useState(kinds[0] ?? '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [confirm, setConfirm] = useState(false);

  function submit() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    onSanction({ kind, reason, note, endsAt });
  }

  return (
    <div className="tb-card">
      <h2 className="tb-h2">Account standing</h2>
      <div className="mt-3 flex flex-col gap-3">
        <Select
          label="Action"
          value={kind}
          ariaLabel="Sanction action"
          onChange={(v) => {
            setKind(v);
            setConfirm(false);
          }}
          options={kinds.map((k) => ({ value: k, label: sanctionLabel(k) }))}
        />
        <Field label="Reason (required, audit-logged)">
          <TextInput value={reason} onChange={setReason} placeholder="e.g. fake GPS trace on fitness test" />
        </Field>
        <Field label="Internal note (optional)">
          <TextInput value={note} onChange={setNote} placeholder="reviewer note, not sent to the partner" />
        </Field>
        {showEndsAt && (
          <Field label="Freeze ends (optional)">
            <TextInput type="datetime-local" value={endsAt} onChange={setEndsAt} />
          </Field>
        )}
      </div>
      {err !== '' && <Note tone="error">{err}</Note>}
      {done !== '' && <Note tone="info">{done}</Note>}
      <div className="tb-actions">
        <Button variant={confirm ? 'danger' : 'soft'} disabled={busy} onClick={submit}>
          {confirm ? `Confirm ${kind || 'action'}` : 'Apply'}
        </Button>
      </div>
      <h3 className="tb-h2 mt-4">History ({history.length})</h3>
      {history.length === 0 ? (
        <p className="tb-sub mt-3">No sanctions recorded.</p>
      ) : (
        <dl className="tb-kv mt-3">
          {history.map((s) => (
            <Fragment key={s.id}>
              <dt>{formatValue(s.created_at)}</dt>
              <dd>
                {formatValue(s.kind)}
                {s.reason_code || s.reason ? ` · ${formatValue(s.reason_code ?? s.reason)}` : ''}
                {s.prev_status ? ` (was ${s.prev_status})` : ''}
                {s.ends_at ? ` until ${s.ends_at}` : ''}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
