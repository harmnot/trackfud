import { create } from 'zustand';

export type CartItem = { id: string; name: string; priceMinor: number; currency: string; qty: number };

type CartState = {
  items: CartItem[];
  /** Single-restaurant checkout: the restaurant behind the current cart. */
  merchantId: string | null;
  add: (item: Omit<CartItem, 'qty'>, merchant: { id: string }) => void;
  setQty: (args: { id: string; qty: number }) => void;
  clear: () => void;
};

function load(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem('tb:customer:cart') ?? '[]') as CartItem[];
  } catch {
    return [];
  }
}
function save(items: CartItem[]) {
  localStorage.setItem('tb:customer:cart', JSON.stringify(items));
}

export const useCart = create<CartState>((set, get) => ({
  items: load(),
  merchantId: loadMerchant(),
  add: (item, merchant) => {
    const sameShop = get().merchantId === null || get().merchantId === merchant.id;
    const base = sameShop ? get().items : [];
    const found = base.find((i) => i.id === item.id);
    const next = found
      ? base.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i))
      : [...base, { ...item, qty: 1 }];
    save(next);
    saveMerchant(merchant.id);
    set({ items: next, merchantId: merchant.id });
  },
  setQty: ({ id, qty }) => {
    const next = get()
      .items.map((i) => (i.id === id ? { ...i, qty } : i))
      .filter((i) => i.qty > 0);
    save(next);
    // Keep the single-restaurant invariant: an emptied cart forgets its shop.
    if (next.length === 0) saveMerchant(null);
    set({ items: next, merchantId: next.length === 0 ? null : get().merchantId });
  },
  clear: () => {
    save([]);
    saveMerchant(null);
    set({ items: [], merchantId: null });
  },
}));

function loadMerchant(): string | null {
  try {
    return (localStorage.getItem('tb:customer:cart-shop') as string | null) ?? null;
  } catch {
    return null;
  }
}
function saveMerchant(id: string | null) {
  try {
    if (id) localStorage.setItem('tb:customer:cart-shop', id);
    else localStorage.removeItem('tb:customer:cart-shop');
  } catch {
    /* private mode: cart still works for this session */
  }
}
