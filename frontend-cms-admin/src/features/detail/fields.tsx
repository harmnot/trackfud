import { useState } from 'react';
import { formatHours, formatValue, MISSING } from '../../lib/format';
import type { MerchantDetail, OpeningHoursValue } from '../../lib/types';

/** Read a string field from an unknown record without `any`. */
function strOf(record: Record<string, unknown>, key: string): string {
  const v = record[key];
  return typeof v === 'string' ? v : '';
}

function boolOf(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

/** Copy-to-clipboard button (44px touch target, inline). Falls back to a
 * hidden textarea when the async Clipboard API is unavailable. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (value === '') return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button
      type="button"
      className="tb-copy"
      onClick={() => void copy()}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

/** Email as a tappable mailto link (no raw dump). */
export function EmailLink({ email }: { email: string }) {
  if (email === '') return <span>{MISSING}</span>;
  return (
    <span className="tb-inline">
      <a className="tb-link" href={`mailto:${encodeURIComponent(email)}`}>
        {email}
      </a>{' '}
      <CopyButton value={email} label="email" />
    </span>
  );
}

/** Phone as a tappable tel link. */
export function PhoneLink({ phone }: { phone: string }) {
  if (phone === '') return <span>{MISSING}</span>;
  return (
    <span className="tb-inline">
      <a className="tb-link" href={`tel:${encodeURIComponent(phone)}`}>
        {phone}
      </a>{' '}
      <CopyButton value={phone} label="phone" />
    </span>
  );
}

/** Opaque ID with a copy button — never a bare UUID wall. */
export function IdValue({ id, label }: { id: string; label: string }) {
  if (id === '') return <span>{MISSING}</span>;
  return (
    <span className="tb-inline">
      <code className="tb-code">{id}</code> <CopyButton value={id} label={label} />
    </span>
  );
}

/** Lat/lng with an "Open in Maps" action + copy. */
export function LocationValue({ lat, lng }: { lat: number; lng: number }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return <span>{MISSING}</span>;
  const query = `${lat}, ${lng}`;
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  return (
    <span className="tb-inline">
      {query}{' '}
      <a className="tb-link" href={href} target="_blank" rel="noreferrer">
        Open in Maps
      </a>{' '}
      <CopyButton value={`${lat},${lng}`} label="coordinates" />
    </span>
  );
}

/** Structured address object (or plain string) rendered as readable lines
 * with a copy button — never raw JSON. */
export function AddressBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>{MISSING}</span>;
  if (typeof value === 'string') {
    if (value === '') return <span>{MISSING}</span>;
    return (
      <span className="tb-inline">
        {value} <CopyButton value={value} label="address" />
      </span>
    );
  }
  if (typeof value !== 'object' || Array.isArray(value)) return <span>{formatValue(value)}</span>;
  const r = value as Record<string, unknown>;
  const lines = [
    strOf(r, 'street') || strOf(r, 'line1') || strOf(r, 'address'),
    [strOf(r, 'city'), strOf(r, 'postal') || strOf(r, 'postcode') || strOf(r, 'zip')].filter(Boolean).join(' '),
    strOf(r, 'country'),
    strOf(r, 'note'),
  ].filter((l) => l !== '');
  if (lines.length === 0) return <span>{formatValue(value)}</span>;
  const flat = lines.join(', ');
  return (
    <span className="tb-stack">
      {lines.map((l) => (
        <span key={l} className="tb-line">
          {l}
        </span>
      ))}
      <span>
        <CopyButton value={flat} label="address" />
      </span>
    </span>
  );
}

/** Emergency contact: name + tappable phone, never a JSON blob. */
export function ContactBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>{MISSING}</span>;
  if (typeof value === 'string') return <span>{value === '' ? MISSING : value}</span>;
  if (typeof value !== 'object' || Array.isArray(value)) return <span>{formatValue(value)}</span>;
  const r = value as Record<string, unknown>;
  const name = strOf(r, 'name');
  const phone = strOf(r, 'phone');
  const relation = strOf(r, 'relation') || strOf(r, 'relationship');
  if (name === '' && phone === '' && relation === '') return <span>{formatValue(value)}</span>;
  return (
    <span className="tb-stack">
      {name !== '' && <strong>{name}</strong>}
      {relation !== '' && <span className="tb-sub tb-tight">{relation}</span>}
      {phone !== '' && (
        <span>
          <PhoneLink phone={phone} />
        </span>
      )}
    </span>
  );
}

/** Bike object: type + motor + size chips instead of a JSON dump. */
export function BikeBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>{MISSING}</span>;
  if (typeof value === 'string') return <span>{value === '' ? MISSING : value}</span>;
  if (typeof value !== 'object' || Array.isArray(value)) return <span>{formatValue(value)}</span>;
  const r = value as Record<string, unknown>;
  const type = strOf(r, 'type');
  const size = strOf(r, 'size');
  const noMotor = boolOf(r, 'no_motor');
  const photo = strOf(r, 'photo_file_id');
  if (type === '' && size === '' && photo === '' && !noMotor) return <span>{formatValue(value)}</span>;
  return (
    <span className="tb-chip-row">
      {type !== '' && <span className="tb-chip">{type}</span>}
      {size !== '' && <span className="tb-chip">{size}</span>}
      <span className="tb-chip">{noMotor ? 'pedal only ✓' : 'motor: check'}</span>
      {photo !== '' && <span className="tb-sub tb-tight">photo in Evidence below</span>}
    </span>
  );
}

/** Consents map: per-purpose checklist with version + date. */
export function ConsentsBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>{MISSING}</span>;
  if (typeof value !== 'object' || Array.isArray(value)) return <span>{formatValue(value)}</span>;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length === 0) return <span>{MISSING}</span>;
  return (
    <ul className="tb-check-list">
      {keys.map((k) => {
        const entry = r[k];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          return (
            <li key={k}>
              <span className="tb-chip">{k}</span> <span>{formatValue(entry)}</span>
            </li>
          );
        }
        const e = entry as Record<string, unknown>;
        const version = strOf(e, 'version');
        const at = strOf(e, 'accepted_at') || strOf(e, 'signed_at') || strOf(e, 'date');
        const ok = version !== '' && at !== '';
        return (
          <li key={k}>
            <span aria-hidden>{ok ? '✓' : '○'}</span> <strong>{k}</strong>
            {version !== '' && <span className="tb-sub"> · {version}</span>}
            {at !== '' && <span className="tb-sub"> · {at}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Opening hours: one row per day, never a JSON blob. */
export function HoursList({ hours }: { hours: Record<string, OpeningHoursValue> }) {
  const entries = Object.entries(hours);
  if (entries.length === 0) return <p className="tb-sub mt-3">No hours set.</p>;
  return (
    <dl className="tb-kv mt-3">
      {entries.map(([day, value]) => (
        <div key={day} className="tb-kv-row">
          <dt>{day}</dt>
          <dd>{formatHours(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Staff roster: mailto + role/status chips, wraps on small phones. */
export function StaffList({ staff }: { staff: NonNullable<MerchantDetail['staff']> }) {
  if (staff.length === 0) return <p className="tb-sub mt-3">No staff invited yet.</p>;
  return (
    <ul className="tb-staff">
      {staff.map((st) => (
        <li key={st.id} className="tb-staff-row">
          <a className="tb-link tb-staff-mail" href={`mailto:${encodeURIComponent(st.email)}`}>
            {st.email}
          </a>
          <span className="tb-chip-row">
            <span className="tb-chip">{st.role || 'staff'}</span>
            <span className="tb-chip">{st.status || 'unknown'}</span>
            {st.on_shift && <span className="tb-chip on">on shift</span>}
            {st.can_deliver && <span className="tb-chip">can deliver</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Signed agreement: summary line + collapsible full text (admin-only view).
 * The sha is shortened with a copy button so the card stays scannable. */
export function AgreementBlock({ agreement }: { agreement: MerchantDetail['agreement'] }) {
  if (!agreement) return <p className="tb-sub mt-3">No signed agreement yet — approve and reject stay hidden until the merchant submits it.</p>;
  const signed = agreement.agreed === true || agreement.signed === true;
  const signedAt = agreement.signed_at ?? null;
  if (!signed && !agreement.signer_name) {
    return <p className="tb-sub mt-3">No signed agreement yet — approve and reject stay hidden until the merchant submits it.</p>;
  }
  const sha = typeof agreement.sha256 === 'string' ? agreement.sha256 : '';
  const shortSha = sha.length > 16 ? `${sha.slice(0, 12)}…` : sha;
  return (
    <div className="mt-3">
      <p className="tb-line">
        {signed ? 'Signed' : 'Not signed'}
        {signedAt ? ` · ${signedAt}` : ''}
        {agreement.signer_name ? ` by ${agreement.signer_name}` : ''}
        {agreement.version ? ` (${agreement.version})` : ''}
      </p>
      {sha !== '' && (
        <p className="tb-sub tb-tight mt-3">
          sha256 <code className="tb-code">{shortSha}</code> <CopyButton value={sha} label="agreement hash" />
        </p>
      )}
      {agreement.text ? (
        <details className="tb-details mt-3">
          <summary>Signed text</summary>
          <pre className="tb-doc mt-3">{agreement.text}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** Decision outcome banner: rejected shows reason + updated_at; approved
 * shows the approval timestamp. Rendered instead of the DecideBox once the
 * application is decided, so reviewers always see "why + when". */
export function ReviewOutcome({
  status,
  reason,
  updatedAt,
  approvedAt,
}: {
  status: string;
  reason: string;
  updatedAt: string | null;
  approvedAt?: string | null;
}) {
  if (status === 'rejected') {
    return (
      <div className="tb-card tb-outcome-rejected mt-3" role="status">
        <h2 className="tb-h2">Rejected</h2>
        <p className="mt-3">
          <strong>Reason:</strong> {reason === '' ? MISSING : reason}
        </p>
        {updatedAt && (
          <p className="tb-sub mt-3">
            Decided at: {updatedAt}
          </p>
        )}
      </div>
    );
  }
  if (status === 'approved') {
    return (
      <div className="tb-card tb-outcome-approved mt-3" role="status">
        <h2 className="tb-h2">Approved</h2>
        <p className="tb-sub mt-3">
          {approvedAt ? `Approved at: ${approvedAt}` : updatedAt ? `Updated at: ${updatedAt}` : 'This application is approved.'}{' '}
          Approve and Reject are hidden.
        </p>
      </div>
    );
  }
  return null;
}
