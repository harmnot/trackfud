import { useEffect, useId, useRef, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react';

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

export function Note({ tone, children, className = '' }: { tone: 'info' | 'error'; children: ReactNode; className?: string }) {
  return (
    <div className={`tb-note tb-note-${tone}${className ? ` ${className}` : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
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

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="tb-switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="tb-track" aria-hidden />
      {label}
    </label>
  );
}

export type SelectOption = { value: string; label: string };

type FieldText = { label?: ReactNode; hint?: ReactNode; error?: ReactNode };

/** Hi-fi single-line text field: design-system input + label/hint/error. */
export function TextInput({
  label,
  hint,
  error,
  value,
  onChange,
  inputRef,
  className = '',
  ...rest
}: FieldText & {
  value: string;
  onChange: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'label'>) {
  const autoId = useId();
  const id = rest.id ?? autoId;
  return (
    <>
      {label ? <label className="tb-label" htmlFor={id}>{label}</label> : null}
      <input
        {...rest}
        id={id}
        ref={inputRef}
        className={`tb-input${error ? ' tb-input-error' : ''}${className ? ` ${className}` : ''}`}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <span className="tb-field-error" role="alert">{error}</span>
        : hint ? <span className="tb-field-hint">{hint}</span> : null}
    </>
  );
}

/** Hi-fi multi-line field: same system, taller, vertical resize. */
export function TextArea({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 3,
  className = '',
  ...rest
}: FieldText & {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  className?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'label'>) {
  const autoId = useId();
  const id = rest.id ?? autoId;
  return (
    <>
      {label ? <label className="tb-label" htmlFor={id}>{label}</label> : null}
      <textarea
        {...rest}
        id={id}
        rows={rows}
        className={`tb-input${error ? ' tb-input-error' : ''}${className ? ` ${className}` : ''}`}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <span className="tb-field-error" role="alert">{error}</span>
        : hint ? <span className="tb-field-hint">{hint}</span> : null}
    </>
  );
}

/** Modern hi-fi native select: styled wrapper + chevron, keeps native sheet on mobile. */
export function Select({
  label,
  hint,
  error,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = '',
}: FieldText & {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const autoId = useId();
  return (
    <>
      {label ? <label className="tb-label" htmlFor={autoId}>{label}</label> : null}
      <span className="tb-select">
        <select
          id={autoId}
          className={`tb-input tb-select-input${error ? ' tb-input-error' : ''}${className ? ` ${className}` : ''}`}
          value={value}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      {error ? <span className="tb-field-error" role="alert">{error}</span>
        : hint ? <span className="tb-field-hint">{hint}</span> : null}
    </>
  );
}

/** Modern segmented radio group (single-select pills, full keyboard support). */
export function RadioGroup({
  label,
  hint,
  error,
  name,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: FieldText & {
  name: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const autoId = useId();
  return (
    <>
      {label ? <span className="tb-label" id={autoId}>{label}</span> : null}
      <span
        className="tb-radio-group"
        role="radiogroup"
        aria-labelledby={label ? autoId : undefined}
        aria-label={label ? undefined : ariaLabel}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <label key={o.value} className={`tb-radio-pill${active ? ' on' : ''}`}>
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={active}
                disabled={disabled}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          );
        })}
      </span>
      {error ? <span className="tb-field-error" role="alert">{error}</span>
        : hint ? <span className="tb-field-hint">{hint}</span> : null}
    </>
  );
}

/** Hi-fi custom radio dot for list/card rows (same motion language as Check).
 * Root is a span (not a label) so rows can stay a single accessible <label>
 * without nesting labels; dot taps forward to the native input. */
export function Radio({
  checked,
  onChange,
  ariaLabel,
  name,
  value,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  return (
    <span
      className="tb-radio"
      onClick={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        e.currentTarget.querySelector('input')?.click();
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={onChange}
      />
      <span className="tb-radio-dot" aria-hidden />
    </span>
  );
}

/** Modern checkbox row with custom box. */
export function Check({
  checked,
  onChange,
  label,
  hint,
  error,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <label className="tb-check">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="tb-box" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path d="m5 13 4 4L19 7" />
          </svg>
        </span>
        <span className="tb-check-label">{label}</span>
      </label>
      {error ? <span className="tb-field-error" role="alert">{error}</span>
        : hint ? <span className="tb-field-hint">{hint}</span> : null}
    </>
  );
}

/** Alias kept so all apps share one name for the checkbox control. */
export const Checkbox = Check;
