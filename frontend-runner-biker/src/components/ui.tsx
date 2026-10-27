import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Dark mono primitives for the Courier app (X/Grok-style components). */

const BASE = import.meta.env.BASE_URL as string;

export function img(name: string): string {
  return `${BASE}img/${name}`;
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="tb-page">{children}</div>;
}

export function List({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`tb-list ${className}`}>{children}</div>;
}

export function Item({ index, children }: { index: number; children: ReactNode }) {
  return <div style={{ ['--i' as string]: index }}>{children}</div>;
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'pine',
  block = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'pine' | 'sun' | 'ink' | 'soft' | 'danger';
  block?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`tb-btn tb-btn-${variant}${block ? ' tb-btn-block' : ''}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label>
      <span className="tb-label">{label}</span>
      {children}
    </label>
  );
}

export function Badge({ sun = false, children }: { sun?: boolean; children: ReactNode }) {
  return <span className={`tb-badge${sun ? ' tb-badge-sun' : ''}`}>{children}</span>;
}

export function Note({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return (
    <div className={`tb-note tb-note-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="tb-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Timer progress ring (session dial). */
export function Ring({ progress, center, sub }: { progress: number; center: ReactNode; sub: ReactNode }) {
  const r = 74;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div className="tb-ring" role="img" aria-label={`Progress ${Math.round(p * 100)} percent`}>
      <svg width="176" height="176" viewBox="0 0 176 176">
        <circle cx="88" cy="88" r={r} fill="none" stroke="rgba(231,233,234,0.12)" strokeWidth="12" />
        <circle
          cx="88"
          cy="88"
          r={r}
          fill="none"
          stroke="var(--tb-ink)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{ transition: 'stroke-dashoffset 0.6s var(--tb-ease)' }}
        />
      </svg>
      <div className="tb-ring-center">
        <strong>{center}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
}

export type DropOption = { value: string; label: string; sub?: string };

/** X-style dropdown menu (button + popover). */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  full = false,
}: {
  label: string;
  value: string;
  options: DropOption[];
  onChange: (v: string) => void;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div className={`tb-dd${open ? ' open' : ''}${full ? ' tb-dd-full' : ''}`} ref={ref}>
      <button type="button" className="tb-dd-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{current?.label ?? value}{current?.sub && full ? <small style={{ color: 'var(--tb-muted)', fontWeight: 500 }}> · {current.sub}</small> : null}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="tb-menu" role="menu">
          {options.map((o) => (
            <button key={o.value} role="menuitemradio" aria-selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}{o.sub ? <small>{o.sub}</small> : null}</span>
              {o.value === value && <span className="tb-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Grok-style file dropzone with attachment chip states. */
export function FileUpload({
  title,
  hint,
  accept = 'image/*',
  fileName,
  busy,
  done,
  onFile,
  onClear,
}: {
  title: string;
  hint: string;
  accept?: string;
  fileName: string | null;
  busy: boolean;
  done: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      {!fileName ? (
        <div
          className={`tb-file${drag ? ' drag' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={title}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        >
          <span className="tb-file-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0 4 4m-4-4-4 4" /><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /></svg>
          </span>
          <p className="tb-file-title">{title}</p>
          <p className="tb-file-sub">{hint}</p>
          <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </div>
      ) : (
        <span className={`tb-chip-file${done ? ' done' : ''}`}>
          {busy ? <span className="tb-spin" aria-hidden /> : done ? <span className="tb-ok">✓</span> : null}
          <span>{fileName}</span>
          <button type="button" aria-label="Remove file" onClick={onClear}>✕</button>
        </span>
      )}
    </div>
  );
}
