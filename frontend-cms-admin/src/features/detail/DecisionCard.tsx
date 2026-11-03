import { useState } from 'react';
import { Button, Field, Note, TextArea } from '../../components/ui';

/** Approve / two-step Reject card. Rendered only while the application is
 * decidable (pending review) — approved / rejected states show the
 * ReviewOutcome banner instead, never this card. */
export function DecideBox({
  onDecide,
  busy,
  err,
  done,
}: {
  onDecide: (approve: boolean, reason: string) => void;
  busy: boolean;
  err: string;
  done: string;
}) {
  const [reason, setReason] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);

  function submit(approve: boolean) {
    if (!approve && !confirmReject) {
      setConfirmReject(true);
      return;
    }
    onDecide(approve, reason);
  }

  return (
    <div className="tb-card">
      <h2 className="tb-h2">Decision</h2>
      <div className="mt-3">
        <Field label="Rejection reason (required to reject)">
          <TextArea
            rows={3}
            value={reason}
            onChange={setReason}
            placeholder="e.g. ID document unreadable — please re-upload"
          />
        </Field>
      </div>
      {err !== '' && <Note tone="error">{err}</Note>}
      {done !== '' && <Note tone="info">{done}</Note>}
      <div className="tb-actions">
        <Button variant="pine" disabled={busy} onClick={() => submit(true)}>
          {busy ? '…' : 'Approve'}
        </Button>
        <Button variant={confirmReject ? 'danger' : 'soft'} disabled={busy} onClick={() => submit(false)}>
          {confirmReject ? 'Confirm reject' : 'Reject'}
        </Button>
      </div>
    </div>
  );
}

/** Disabled decision placeholder: pending but blocked (e.g. merchant has not
 * signed the agreement yet). Keeps the reviewer oriented without allowing a
 * decision the backend would 409. */
export function DecideGated({ message }: { message: string }) {
  return (
    <div className="tb-card" aria-disabled="true">
      <h2 className="tb-h2">Decision</h2>
      <div className="mt-3">
        <Note tone="info">{message}</Note>
      </div>
      <div className="tb-actions">
        <Button variant="pine" disabled>
          Approve
        </Button>
        <Button variant="soft" disabled>
          Reject
        </Button>
      </div>
    </div>
  );
}
