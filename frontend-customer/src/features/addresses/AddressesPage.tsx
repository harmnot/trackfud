/** Saved delivery addresses: list, pin on Google Maps, default.
 * Logged in: server address book (synced + used at pay time). Guest: this
 * device only, via the active delivery point. */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, savedUser } from '../../lib/api';
import { Button, Check, Field, Item, List, Note, Page, Radio, Tag, TextInput } from '../../components/ui';
import { createAddress, deleteAddress, listAddresses, setDefaultAddress, updateAddress } from './api';
import { getActiveId, getActiveLoc } from './active';
import { setActiveDelivery, setDeviceDelivery } from './useDeliveryLocation';
import { GoogleMapPicker } from './GoogleMapPicker';
import type { CustomerAddress } from './types';

const DEFAULT_CENTER = { lat: -6.2088, lng: 106.8456 };

type FormState = { label: string; address: string; lat: string; lng: string; note: string; isDefault: boolean };

function emptyForm(center: { lat: number; lng: number }): FormState {
  return { label: '', address: '', lat: String(center.lat), lng: String(center.lng), note: '', isDefault: false };
}

function fromAddress(a: CustomerAddress): FormState {
  return { label: a.label, address: a.address, lat: String(a.lat), lng: String(a.lng), note: a.note, isDefault: a.is_default };
}

export function AddressesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = savedUser();
  const [activeId, setActiveIdState] = useState<string | null>(() => getActiveId());
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(() => {
    const loc = getActiveLoc();
    return emptyForm(loc ?? DEFAULT_CENTER);
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const saved = useQuery({
    queryKey: ['addresses'],
    queryFn: listAddresses,
    enabled: user !== null,
  });

  useEffect(() => {
    if (user && saved.data && saved.data.length > 0 && !getActiveId()) {
      const def = saved.data.find((a) => a.is_default) ?? saved.data[0]!;
      setActiveDelivery(def);
      setActiveIdState(def.id);
    }
  }, [user, saved.data]);

  function chooseActive(a: CustomerAddress) {
    setActiveDelivery(a);
    setActiveIdState(a.id);
    setMsg(t('location.activeSet', { label: a.label }));
  }

  function startNew() {
    const loc = getActiveLoc();
    setForm(emptyForm(loc ?? DEFAULT_CENTER));
    setEditingId('new');
    setErr('');
    setMsg('');
  }

  function startEdit(a: CustomerAddress) {
    setForm(fromAddress(a));
    setEditingId(a.id);
    setErr('');
    setMsg('');
  }

  function pick(p: { lat: number; lng: number; address?: string }) {
    setForm((f) => ({
      ...f,
      lat: String(Number(p.lat.toFixed(6))),
      lng: String(Number(p.lng.toFixed(6))),
      address: p.address ?? f.address,
    }));
  }

  async function save() {
    setErr('');
    setMsg('');
    const lat = Number.parseFloat(form.lat);
    const lng = Number.parseFloat(form.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setErr(t('location.badCoords'));
      return;
    }
    if (!user) {
      setDeviceDelivery({ lat, lng, note: form.note || undefined });
      setActiveIdState(null);
      setEditingId(null);
      setMsg(t('location.savedDevice'));
      return;
    }
    setBusy(true);
    try {
      const input = {
        label: form.label.trim() || 'Home',
        address: form.address.trim(),
        lat,
        lng,
        note: form.note,
        is_default: form.isDefault,
      };
      const done =
        editingId === 'new' || editingId === null
          ? await createAddress(input)
          : await updateAddress({ id: editingId, ...input });
      setActiveDelivery(done);
      setActiveIdState(done.id);
      setEditingId(null);
      setMsg(t('location.saved'));
      await qc.invalidateQueries({ queryKey: ['addresses'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      const { promotedId } = await deleteAddress(id);
      if (activeId === id) {
        if (promotedId) {
          const next = (saved.data ?? []).find((a) => a.id === promotedId);
          if (next) {
            setActiveDelivery(next);
            setActiveIdState(next.id);
          }
        } else {
          setDeviceDelivery({ lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng });
          setActiveIdState(null);
        }
      }
      setMsg(t('location.deleted'));
      await qc.invalidateQueries({ queryKey: ['addresses'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    setErr('');
    setBusy(true);
    try {
      await setDefaultAddress(id);
      const next = (saved.data ?? []).find((a) => a.id === id);
      if (next) {
        setActiveDelivery(next);
        setActiveIdState(next.id);
      }
      setMsg(t('location.defaultSet'));
      await qc.invalidateQueries({ queryKey: ['addresses'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const list = saved.data ?? [];
  const editing = editingId !== null;
  const formLat = Number.parseFloat(form.lat);
  const formLng = Number.parseFloat(form.lng);
  const mapCenter = {
    lat: Number.isFinite(formLat) ? formLat : DEFAULT_CENTER.lat,
    lng: Number.isFinite(formLng) ? formLng : DEFAULT_CENTER.lng,
  };

  return (
    <Page>
      <h1 className="tb-display">{t('location.title')}</h1>
      <p className="tb-sub">{t('location.sub')}</p>

      {user && saved.isLoading && <p className="tb-sub mt-3">{t('common.loading')}</p>}
      {user && saved.isError && (
        <div className="mt-3">
          <Note tone="error">{t('common.error')}: {(saved.error as Error).message}</Note>
        </div>
      )}

      {user && !editing && (
        <>
          <List className="flex flex-col gap-2 mt-3">
            {list.map((a, i) => (
              <Item key={a.id} index={i}>
                <div className={`tb-addr${activeId === a.id ? ' on' : ''}`}>
                  <Radio
                    name="active-address"
                    value={a.id}
                    ariaLabel={t('location.useAsDelivery', { label: a.label })}
                    checked={activeId === a.id}
                    onChange={() => chooseActive(a)}
                  />
                  <span className="tb-addr-body">
                    <span className="tb-addr-name">
                      {a.label}
                      {a.is_default && <Tag>{t('location.defaultBadge')}</Tag>}
                      {activeId === a.id && <Tag tone="dim">{t('location.activeBadge')}</Tag>}
                    </span>
                    {a.address && <span className="tb-addr-sub block">{a.address}</span>}
                    {a.note && <span className="tb-addr-sub block">{a.note}</span>}
                    <span className="tb-addr-coords block">
                      {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
                    </span>
                    <span className="tb-addr-actions">
                      {!a.is_default && (
                        <Button size="sm" variant="soft" disabled={busy} onClick={() => void makeDefault(a.id)}>
                          {t('location.makeDefault')}
                        </Button>
                      )}
                      <Button size="sm" variant="soft" onClick={() => startEdit(a)}>
                        {t('common.edit')}
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(a.id)}>
                        {t('common.delete')}
                      </Button>
                    </span>
                  </span>
                </div>
              </Item>
            ))}
          </List>
          {list.length === 0 && !saved.isLoading && <p className="tb-sub mt-3">{t('location.empty')}</p>}
          <div className="mt-3">
            <Button variant="ember" block onClick={startNew}>
              {t('location.addNew')}
            </Button>
          </div>
        </>
      )}

      {(!user || editing) && (
        <div className="flex flex-col gap-3 mt-3">
          {!user && (
            <Note tone="info">{t('location.guestHint')}</Note>
          )}
          <GoogleMapPicker lat={mapCenter.lat} lng={mapCenter.lng} onPick={pick} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('location.lat')}>
              <TextInput
                inputMode="decimal"
                value={form.lat}
                placeholder={t('location.latPh', { defaultValue: 'e.g. -6.2088' })}
                onChange={(v) => setForm({ ...form, lat: v })}
              />
            </Field>
            <Field label={t('location.lng')}>
              <TextInput
                inputMode="decimal"
                value={form.lng}
                placeholder={t('location.lngPh', { defaultValue: 'e.g. 106.8456' })}
                onChange={(v) => setForm({ ...form, lng: v })}
              />
            </Field>
          </div>
          {user && (
            <Field label={t('location.label')}>
              <TextInput
                value={form.label}
                maxLength={60}
                placeholder="Home"
                onChange={(v) => setForm({ ...form, label: v })}
              />
            </Field>
          )}
          {user && (
            <Field label={t('location.address')}>
              <TextInput
                value={form.address}
                maxLength={500}
                placeholder={t('location.addressPh')}
                onChange={(v) => setForm({ ...form, address: v })}
              />
            </Field>
          )}
          <Field label={t('location.note')}>
            <TextInput
              value={form.note}
              placeholder={t('location.notePh', { defaultValue: 'e.g. Green gate, call on arrival' })}
              onChange={(v) => setForm({ ...form, note: v })}
            />
          </Field>
          {user && (
            <Check
              checked={form.isDefault}
              onChange={(v) => setForm({ ...form, isDefault: v })}
              label={t('location.makeDefault')}
            />
          )}
          <div className="flex flex-col gap-2">
            <Button variant="ember" block disabled={busy} onClick={() => void save()}>
              {busy ? '…' : t('location.save')}
            </Button>
            {user && editing && (
              <Button variant="soft" block onClick={() => { setEditingId(null); setErr(''); }}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </div>
      )}

      {msg && (
        <div className="mt-3">
          <Note tone="info">{msg}</Note>
        </div>
      )}
      {err && (
        <div className="mt-3">
          <Note tone="error">{err}</Note>
        </div>
      )}

    </Page>
  );
}
