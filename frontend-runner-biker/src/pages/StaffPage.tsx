/**
 * Staff mode entry: the merchant invites this account's email
 * (merchant app → Staff), then staff pick the restaurant here and clock
 * on-shift via `POST /courier/staff/shift`. No fitness test, fallback
 * offers only. Staff deliver on foot / bike / their own way with the same
 * tracked delivery flow, and earnings land in the same wallet.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Field, Note, Page, TextInput } from '../components/ui';
import { useStaff, type StaffTravel } from '../features/staff/staffStore';
import { fetchMemberships, setStaffShift } from '../features/delivery/courierApi';
import { fetchMe } from '../features/profile/profileApi';
import { ApiError } from '../lib/api';
import { logger } from '../lib/logger';

export function StaffPage(): React.JSX.Element {
  const { t } = useTranslation();
  const nav = useNavigate();
  const staff = useStaff();
  const membersQ = useQuery({
    queryKey: ['staff-memberships'],
    queryFn: fetchMemberships,
    enabled: !staff.active,
  });
  const meQ = useQuery({ queryKey: ['staff-me'], queryFn: fetchMe, enabled: !staff.active });
  const [merchantId, setMerchantId] = useState('');
  const [name, setName] = useState('');
  const [travel, setTravel] = useState<StaffTravel>('foot');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function leave(): Promise<void> {
    setBusy(true);
    try {
      await setStaffShift({ merchantId: staff.merchantId, onShift: false });
    } catch (err) {
      logger.warn('clock off-shift failed, leaving locally', err);
    } finally {
      staff.exit();
      setBusy(false);
    }
  }

  async function enter(): Promise<void> {
    if (name.trim().length < 2) {
      setMsg(t('staff.badName'));
      return;
    }
    const picked = (membersQ.data ?? []).find((m) => m.merchant_id === merchantId);
    if (!picked) {
      setMsg(t('staff.restaurant'));
      return;
    }
    if (!picked.can_deliver) {
      setMsg(t('staff.needDeliver'));
      return;
    }
    setMsg('');
    setBusy(true);
    try {
      await setStaffShift({ merchantId: picked.merchant_id, onShift: true });
    } catch (err) {
      logger.warn('clock on-shift failed', err);
      setMsg(err instanceof ApiError ? err.message : t('staff.notAllowed'));
      setBusy(false);
      return;
    }
    staff.enter({
      merchantId: picked.merchant_id,
      staffName: name.trim(),
      merchantName: picked.merchant_name,
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
          <div className="flex-1"><Button block variant="soft" disabled={busy} onClick={() => void leave()}>{t('staff.exit')}</Button></div>
        </div>
      </Page>
    );
  }

  const members = membersQ.data ?? [];
  useEffect(() => {
    if (merchantId === '' && members.length === 1) setMerchantId(members[0].merchant_id);
  }, [merchantId, members]);

  return (
    <Page>
      <h1 className="tb-display">{t('staff.title')}</h1>
      <p className="tb-sub">{t('staff.intro')}</p>
      {membersQ.isLoading && <p className="tb-sub mt-3">{t('common.loading')}</p>}
      {membersQ.isError && (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('common.error')}</Note>
          <Button variant="soft" block onClick={() => void membersQ.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      {membersQ.isSuccess && members.length === 0 && (
        <div className="tb-card mt-3">
          <p className="text-sm font-bold">{t('staff.noInvite')}</p>
          <p className="tb-sub mt-1">{t('staff.noInviteBody')}</p>
          {meQ.data?.email && <p className="mt-2 font-bold">{meQ.data.email}</p>}
          <p className="tb-sub mt-2">{t('staff.joinHint')}</p>
          <div className="mt-3">
            <Link to="/status" className="tb-btn tb-btn-soft tb-btn-block">{t('nav.status')}</Link>
          </div>
        </div>
      )}
      {members.length > 0 && (
        <>
          <div className="mt-3 flex flex-col gap-3">
            <Field label={t('staff.restaurant')}>
              <Dropdown
                label={t('staff.restaurant')}
                full
                value={merchantId}
                options={members.map((m) => ({
                  value: m.merchant_id,
                  label: m.merchant_name,
                  sub: m.status,
                }))}
                onChange={setMerchantId}
              />
            </Field>
            <Field label={t('staff.name')}>
              <TextInput value={name} onChange={setName} placeholder="Sari" />
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
        </>
      )}
    </Page>
  );
}
