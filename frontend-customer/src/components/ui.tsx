import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Ultra-HiFi primitives for the Customer app. */

const BASE = import.meta.env.BASE_URL as string;

export function img(name: string): string {
  return `${BASE}img/${name}`;
}

/** Map a menu item name to its dish photo. */
export function dishImage(enName: string): string {
  const n = enName.toLowerCase();
  if (n.includes('wrap') || n.includes('tofu')) return img('dish-wrap.jpg');
  if (n.includes('tea') || n.includes('teh')) return img('dish-tea.jpg');
  if (n.includes('salad') || n.includes('fruit')) return img('dish-salad.jpg');
  return img('dish-chicken.jpg');
}

/** Banner per restaurant currency/region. */
export function bannerImage(currency: string): string {
  return currency === 'GBP' ? img('banner-london.jpg') : img('banner-jakarta.jpg');
}

/** Deterministic pseudo-rating 4.4–4.9 from an id string. */
export function ratingFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 100;
  return (4.4 + (h % 6) / 10).toFixed(1);
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
  variant = 'brand',
  size = 'md',
  block = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'brand' | 'ember' | 'ink' | 'soft' | 'quiet' | 'danger';
  size?: 'md' | 'sm';
  block?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`tb-btn tb-btn-${variant}${size === 'sm' ? ' tb-btn-sm' : ''}${block ? ' tb-btn-block' : ''}`}
    >
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

export function Tag({ tone = 'ok', children }: { tone?: 'ok' | 'warn' | 'dim'; children: ReactNode }) {
  return <span className={`tb-tag${tone === 'warn' ? ' tb-tag-warn' : tone === 'dim' ? ' tb-tag-dim' : ''}`}>{children}</span>;
}

export function Skeleton({ height = 150 }: { height?: number }) {
  return <div className="tb-skel" style={{ height }} aria-hidden />;
}

export function Note({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return (
    <div className={`tb-note tb-note-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
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
