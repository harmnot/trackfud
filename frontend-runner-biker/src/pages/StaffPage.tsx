/**
 * Staff mode entry: merchant-invited login, no fitness test, fallback
 * offers only. Staff deliver on foot / bike / their own way with the same
 * tracked delivery flow, and earnings land in the same wallet.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button, Dropdown, Field, Note, Page } from '../components/ui';
import { isInviteCodeWellFormed, useStaff, type StaffTravel } from '../features/staff/staffStore';

export function StaffPage(): React.JSX.Element {
  const { t } = useTranslation();
  const nav = useNavigate();
  const staff = useStaff();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [travel, setTravel] = useState<StaffTravel>('foot');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function enter(): Promise<void> {
    if (!isInviteCodeWellFormed(code)) {
      setMsg(t('staff.badCode'));
      return;
    }
    if (name.trim().length < 2) {
      setMsg(t('staff.badName'));
      return;
    }
    // openapi.yaml has no courier-side invite check (the invite is created
    // by the merchant app), so the code is validated locally for format
    // only. Live fallback offers then come from `GET /courier/staff/offers`.
    setBusy(true);
    staff.enter({
      inviteCode: code.trim(),
      staffName: name.trim(),
      merchantName: t('staff.demoMerchant'),
      travel,
    });
    setBusy(false);
    nav('/run-setup');
  }

  if (staff.active) {
    return (
      <Page>
        <h1 className="tb-display">{t('staff.title')}</h1>
        <div className="tb-card mt-3">
          <p className="text-sm font-bold">{staff.staffName} · {staff.merchantName}</p>
          <p className="tb-sub mt-1">{t('staff.fallbackOnly')} · {t(`staff.travel_${staff.travel}`)}</p>
          <p className="tb-sub mt-1">{t('staff.noTest')}</p>
        </div>
        <div className="mt-3 flex gap-2">
          <div className="flex-1"><Link to="/run-setup" className="tb-btn tb-btn-sun tb-btn-block">{t('run.start')}</Link></div>
          <div className="flex-1"><Button block variant="soft" onClick={() => staff.exit()}>{t('staff.exit')}</Button></div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <h1 className="tb-display">{t('staff.title')}</h1>
      <p className="tb-sub">{t('staff.intro')}</p>
      <div className="mt-3 flex flex-col gap-3">
        <Field label={t('staff.invite')}>
          <input className="tb-input tb-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WARUNG-42" aria-label={t('staff.invite')} />
        </Field>
        <Field label={t('staff.name')}>
          <input className="tb-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sari" />
        </Field>
        <Field label={t('staff.travel')}>
          <Dropdown
            label={t('staff.travel')}
            full
            value={travel}
            options={[
              { value: 'foot', label: t('staff.travel_foot') },
              { value: 'bike', label: t('staff.travel_bike') },
              { value: 'own', label: t('staff.travel_own') },
            ]}
            onChange={(v) => setTravel(v as StaffTravel)}
          />
        </Field>
      </div>
      {msg && <div className="mt-3"><Note tone="error">{msg}</Note></div>}
      <div className="mt-3"><Button block variant="sun" disabled={busy} onClick={() => void enter()}>{t('staff.enter')}</Button></div>
      <div className="mt-2"><Note tone="info">{t('staff.fallbackOnly')}</Note></div>
    </Page>
  );
}
