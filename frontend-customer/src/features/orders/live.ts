/** Live order-status channel: WS ticket connect, typed `order.status` fan-out.
 * Reconnects with backoff; never reloads the page (no silent SW reload mid-order). */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsTicket } from '../../lib/api';
import { logger } from '../../lib/logger';
import { parseWsOrderStatus } from './types';

const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

/** Open one WS session and invoke `onStatus` for every `order.status` message. */
export function connectLiveOrders(args: { onStatus: (orderId: string, status: string) => void }): () => void {
  let closed = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function handleMessage(event: MessageEvent<unknown>) {
    let data: unknown = null;
    try {
      data = typeof event.data === 'string' ? (JSON.parse(event.data) as unknown) : event.data;
    } catch {
      logger.warn('live message not JSON', {});
      return;
    }
    const msg = parseWsOrderStatus(data);
    if (msg) args.onStatus(msg.order_id, msg.status);
  }

  function connect() {
    if (closed) return;
    void wsTicket().then((ticket) => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/api/v1/ws?ticket=${ticket}`);
      socket.onopen = () => {
        attempt = 0;
        logger.info('live orders connected', {});
        socket?.send(JSON.stringify({ type: 'ping' }));
      };
      socket.onmessage = (event: MessageEvent<unknown>) => handleMessage(event);
      socket.onclose = () => schedule();
      socket.onerror = () => {
        logger.warn('live orders socket error', {});
        socket?.close();
      };
    }).catch(() => schedule());
  }

  function schedule() {
    if (closed) return;
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 30000;
    attempt += 1;
    logger.info('live orders retry scheduled', { waitMs: wait });
    timer = setTimeout(connect, wait);
  }

  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}

/** Subscribe the react-query cache to live `order.status` pushes for one order. */
export function useLiveOrderStatus(args: { orderId: string }): void {
  const qc = useQueryClient();
  useEffect(() => {
    return connectLiveOrders({
      onStatus: (orderId, status) => {
        if (orderId !== args.orderId) return;
        logger.info('live order status', { orderId, status });
        void qc.invalidateQueries({ queryKey: ['order', args.orderId] });
      },
    });
  }, [args.orderId, qc]);
}
