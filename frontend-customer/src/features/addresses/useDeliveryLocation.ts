/** Active delivery point shared by Home, topbar and the address book.
 * Logged in: the chosen address wins, otherwise the server default, otherwise
 * the first saved address. Guests / offline: the device-only point kept in
 * localStorage. Falls back to central Jakarta only when nothing is stored.
 * All reads come from the API (`GET /v1/customer/addresses`) or the stored
 * active point — never hardcoded per-restaurant data. */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { savedUser } from '../../lib/api';
import { getActiveId, getActiveLoc, setActiveLoc, type ActiveLoc } from './active';
import { listAddresses } from './api';
import type { CustomerAddress } from './types';

export const DEFAULT_CENTER = { lat: -6.2088, lng: 106.8456 };

export const DELIVERY_LOCATION_EVENT = 'tb:delivery-location';

export type DeliverySource = 'active' | 'default' | 'device' | 'fallback';

export type DeliveryLocation = {
  /** Coords used for distance sorting + quotes. */
  loc: { lat: number; lng: number };
  /** Id of the chosen saved address, when the point comes from the book. */
  activeId: string | null;
  /** The chosen saved address, when the point comes from the book. */
  activeAddress: CustomerAddress | null;
  /** Server default address, when one exists. */
  defaultAddress: CustomerAddress | null;
  /** Where `loc` came from. */
  source: DeliverySource;
  /** True while the address book is loading for a signed-in user. */
  isLoading: boolean;
  /** True when at least one saved address exists. */
  hasSaved: boolean;
};

/** Persist a chosen address as the delivery point + notify listeners. */
export function setActiveDelivery(address: CustomerAddress): void {
  setActiveLoc(
    { lat: address.lat, lng: address.lng, note: address.note || undefined },
    address.id,
  );
}

/** Persist a device-only point (guest flow) + notify listeners. */
export function setDeviceDelivery(loc: ActiveLoc): void {
  setActiveLoc(loc, null);
}

function readId(): string | null {
  return getActiveId();
}

function readLoc(): ActiveLoc | null {
  return getActiveLoc();
}

/** Reactive delivery point: server default hydrates the stored point. */
export function useDeliveryLocation(): DeliveryLocation {
  const userId = savedUser()?.id ?? null;
  const [activeId, setActiveIdState] = useState<string | null>(() => readId());
  const [deviceLoc, setDeviceLoc] = useState<ActiveLoc | null>(() => readLoc());

  const saved = useQuery({
    queryKey: ['addresses'],
    queryFn: listAddresses,
    enabled: userId !== null,
  });

  // Keep every mounted consumer in sync when any screen picks a point.
  useEffect(() => {
    function sync(): void {
      setActiveIdState(readId());
      setDeviceLoc(readLoc());
    }
    window.addEventListener(DELIVERY_LOCATION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DELIVERY_LOCATION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const list = saved.data ?? [];
  const defaultAddress = list.find((a) => a.is_default) ?? null;

  // First run on a signed-in device with no stored choice: adopt the server
  // default (or the first saved address) so Home sorts from the right point.
  useEffect(() => {
    if (!userId || saved.data === undefined || saved.data.length === 0) return;
    if (readId()) return;
    const next = saved.data.find((a) => a.is_default) ?? saved.data[0];
    if (!next) return;
    setActiveDelivery(next);
    setActiveIdState(next.id);
    setDeviceLoc({
      lat: next.lat,
      lng: next.lng,
      note: next.note || undefined,
    });
  }, [userId, saved.data]);

  if (userId && list.length > 0) {
    const activeAddress =
      list.find((a) => a.id === activeId) ?? defaultAddress ?? list[0] ?? null;
    if (activeAddress) {
      return {
        loc: { lat: activeAddress.lat, lng: activeAddress.lng },
        activeId: activeAddress.id,
        activeAddress,
        defaultAddress,
        source: activeAddress.id === activeId ? 'active' : 'default',
        isLoading: saved.isLoading,
        hasSaved: true,
      };
    }
  }

  if (deviceLoc) {
    // A stored device point may carry an id whose address was deleted or
    // belongs to a signed-out account — resolve it when possible.
    const activeAddress = activeId
      ? (list.find((a) => a.id === activeId) ?? null)
      : null;
    return {
      loc: { lat: deviceLoc.lat, lng: deviceLoc.lng },
      activeId,
      activeAddress,
      defaultAddress,
      source: activeAddress ? 'active' : 'device',
      isLoading: saved.isLoading,
      hasSaved: list.length > 0,
    };
  }

  if (userId && defaultAddress) {
    return {
      loc: { lat: defaultAddress.lat, lng: defaultAddress.lng },
      activeId: defaultAddress.id,
      activeAddress: defaultAddress,
      defaultAddress,
      source: 'default',
      isLoading: saved.isLoading,
      hasSaved: true,
    };
  }

  return {
    loc: DEFAULT_CENTER,
    activeId: null,
    activeAddress: null,
    defaultAddress,
    source: 'fallback',
    isLoading: saved.isLoading,
    hasSaved: list.length > 0,
  };
}
