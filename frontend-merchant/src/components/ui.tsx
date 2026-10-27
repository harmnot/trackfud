import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Ultra-HiFi calm-craft primitives for the Merchant app. */

const BASE = import.meta.env.BASE_URL as string;

export function img(name: string): string {
  return `${BASE}img/${name}`;
}

const FACES = ['#3f3f46', '#134e4a', '#78350f', '#4c1d95', '#1e3a5f'];

export function faceColor(email: string): string {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) % 997;
  return FACES[h % FACES.length] as string;
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
  variant = 'clay',
  block = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'clay' | 'pine' | 'ink' | 'soft' | 'danger';
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

export function Badge({ green = false, children }: { green?: boolean; children: ReactNode }) {
  return <span className={`tb-badge${green ? ' tb-badge-green' : ''}`}>{children}</span>;
}

export function Note({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return (
    <div className={`tb-note tb-note-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Steps({ total, done, labels }: { total: number; done: number; labels: string[] }) {
  return (
    <div>
      <div className="tb-steps" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < done ? 'on' : ''} />
        ))}
      </div>
      <div className="tb-step-label" aria-hidden>
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

export type DropOption = { value: string; label: string };

/** X-style dropdown menu (button + popover). */
export function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: DropOption[];
  onChange: (v: string) => void;
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
    <div className={`tb-dd${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="tb-dd-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {current?.label ?? value}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="tb-menu" role="menu">
          {options.map((o) => (
            <button key={o.value} role="menuitemradio" aria-selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}
              {o.value === value && <span className="tb-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="tb-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tb-track" aria-hidden />
      {label}
    </label>
  );
}
