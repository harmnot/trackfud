/** C3 data hooks: server state in react-query, local-first writes, WS chat
 * fan-out, and outbox reconnect + backlog resend. */

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { wsTicket } from '../../lib/api';
import { logger } from '../../lib/logger';
import {
  chooseNoCourier,
  fetchImpact,
  fetchThread,
  getNoCourierChoice,
  getRating,
  listCheers,
  listMessages,
  mergeThread,
  sendCheer,
  sendMessage,
  storeIncoming,
  submitRatings,
  translateMessage,
  type RatingsInput,
} from './api';
import { flush, pendingItems } from './outbox';
import {
  parseWsChatMessage,
  type CheerId,
  type NoCourierChoice,
  type QuickReplyId,
  type RatingTarget,
  type Stars,
} from './types';

const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

function translateTarget(lang: string): 'en' | 'id' | 'ms' {
  if (lang === 'id' || lang === 'ms') return lang;
  return 'en';
}

/** Saved rating for one order + target (courier vs restaurant, separate). */
export function useRating(args: { orderId: string; target: RatingTarget }) {
  return useQuery({
    queryKey: ['rating', args.orderId, args.target],
    queryFn: () => getRating({ orderId: args.orderId, target: args.target }),
  });
}

/** Submit both ratings in one server call, then refresh the cards. */
export function useSubmitRatings(args: { orderId: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RatingsInput) => submitRatings({ orderId: args.orderId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rating', args.orderId] });
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    },
  });
}

/** Chat thread for one order: server thread merged with local drafts. */
export function useChat(args: { orderId: string }) {
  return useQuery({
    queryKey: ['chat', args.orderId],
    queryFn: async () => {
      try {
        const thread = await fetchThread({ orderId: args.orderId });
        return mergeThread({ orderId: args.orderId, thread });
      } catch {
        logger.warn('chat thread offline, showing local rows', { orderId: args.orderId });
        return listMessages({ orderId: args.orderId });
      }
    },
    refetchInterval: 15000,
  });
}

/** Send a chat message (quick reply or free text). */
export function useSendChat(args: { orderId: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; canonicalId?: QuickReplyId }) =>
      sendMessage({ orderId: args.orderId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat', args.orderId] });
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    },
  });
}

/** Translate one free-text message; quick replies stay dictionary-based. */
export function useTranslateChat(args: { orderId: string; lang: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      translateMessage({ orderId: args.orderId, messageId, to: translateTarget(args.lang) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat', args.orderId] });
    },
  });
}

/** Live `chat.message` WS fan-out for one order; reconnects with backoff and
 * re-sends the backlog via the outbox on every reconnect. */
export function useLiveChat(args: { orderId: string }): void {
  const qc = useQueryClient();
  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule() {
      if (closed) return;
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 30000;
      attempt += 1;
      timer = setTimeout(connect, wait);
    }
    function connect() {
      if (closed) return;
      void wsTicket()
        .then((ticket) => {
          if (closed) return;
          const proto = location.protocol === 'https:' ? 'wss' : 'ws';
          socket = new WebSocket(`${proto}://${location.host}/api/v1/ws?ticket=${ticket}`);
          socket.onopen = () => {
            attempt = 0;
            logger.info('live chat connected', {});
            void resendBacklog();
            async function resendBacklog() {
              await flush();
              await qc.invalidateQueries({ queryKey: ['outbox'] });
              await qc.invalidateQueries({ queryKey: ['chat', args.orderId] });
            }
          };
          socket.onmessage = (event: MessageEvent<unknown>) => {
            let data: unknown = null;
            try {
              data = typeof event.data === 'string' ? (JSON.parse(event.data) as unknown) : event.data;
            } catch {
              logger.warn('chat message not JSON', {});
              return;
            }
            const msg = parseWsChatMessage(data);
            if (msg && msg.orderId === args.orderId) {
              storeIncoming({
                orderId: msg.orderId,
                text: msg.text,
                lang: msg.lang === '' ? undefined : msg.lang,
                at: msg.at,
                serverId: msg.serverId ?? undefined,
              });
              void qc.invalidateQueries({ queryKey: ['chat', args.orderId] });
            }
          };
          socket.onclose = () => schedule();
          socket.onerror = () => socket?.close();
        })
        .catch(() => schedule());
    }
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [args.orderId, qc]);
}

/** Cheers sent on one order, newest first. */
export function useCheers(args: { orderId: string }) {
  return useQuery({ queryKey: ['cheers', args.orderId], queryFn: () => listCheers({ orderId: args.orderId }) });
}

/** Send a cheer the runner hears via the Voice Copilot. */
export function useSendCheer(args: { orderId: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cheerId: CheerId | null; text: string }) =>
      sendCheer({ orderId: args.orderId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cheers', args.orderId] });
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    },
  });
}

/** Latest no-courier choice for one order. */
export function useNoCourier(args: { orderId: string }) {
  return useQuery({
    queryKey: ['nocourier', args.orderId],
    queryFn: () => getNoCourierChoice({ orderId: args.orderId }),
  });
}

/** Record wait/pickup/cancel through the real `delivery-choice` endpoint. */
export function useChooseNoCourier(args: { orderId: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (choice: NoCourierChoice) => chooseNoCourier({ orderId: args.orderId, choice }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['nocourier', args.orderId] });
      void qc.invalidateQueries({ queryKey: ['order', args.orderId] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    },
  });
}

/** Measured customer impact (`GET /v1/customer/impact`). */
export function useImpact() {
  return useQuery({ queryKey: ['impact'], queryFn: fetchImpact, staleTime: 60 * 1000 });
}

export type SyncState = { online: boolean; pending: number; flushing: boolean };

/** Online/offline + pending-sync badge state; flushes the backlog on
 * reconnect, window focus, and manual resend. Never reloads mid-order. */
export function useSync(): SyncState & { resend: () => void } {
  const qc = useQueryClient();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(() => pendingItems().length);
  const [flushing, setFlushing] = useState(false);

  const refresh = useCallback(() => setPending(pendingItems().length), []);
  const resend = useCallback(() => {
    setFlushing(true);
    void runResend();
    async function runResend() {
      try {
        const summary = await flush();
        setPending(summary.pending);
        await qc.invalidateQueries({ queryKey: ['chat'] });
        await qc.invalidateQueries({ queryKey: ['cheers'] });
      } catch {
        logger.warn('manual resend failed', {});
      } finally {
        setFlushing(false);
      }
    }
  }, [qc]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      resend();
    };
    const down = () => setOnline(false);
    const focus = () => {
      if (navigator.onLine) resend();
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('focus', focus);
    };
  }, [resend]);

  useEffect(() => {
    refresh();
  }, [refresh, online]);

  return { online, pending, flushing, resend };
}
