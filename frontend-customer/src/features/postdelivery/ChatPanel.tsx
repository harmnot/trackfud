/** Translated chat with quick replies. Quick replies are a closed,
 * fully-translated set so both sides read them in their own language;
 * free text goes through `POST .../messages/translate` (B6 live, dictionary
 * fallback) with the offline quick-reply dictionary kept as fallback. */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { Button, Note, Skeleton } from '../../components/ui';
import i18n from '../../i18n';
import { useChat, useLiveChat, useSendChat, useTranslateChat } from './hooks';
import { QUICK_REPLY_IDS, type ChatMessage, type QuickReplyId } from './types';

function quickText(id: QuickReplyId, t: (k: string) => string): string {
  return t(`chat.q_${id}`);
}

/** One message row: translated text first, original kept underneath. */
function MessageRow(args: { m: ChatMessage; t: (k: string) => string; onTranslate: (id: string) => void; translating: boolean }) {
  const { m, t, onTranslate, translating } = args;
  const body = m.canonicalId ? quickText(m.canonicalId, t) : (m.translated ?? m.text);
  const showOriginal = !m.canonicalId && m.translated !== null && m.translated !== m.text;
  const canTranslate = !m.canonicalId && m.serverId !== null && m.translated === null;
  return (
    <li className={m.from === 'me' ? 'me' : 'them'}>
      <p>{body}</p>
      {showOriginal && <p className="tb-sub">{m.text}</p>}
      <span>
        {m.canonicalId ? t('chat.translated') : (m.lang === '' ? t('chat.live') : m.lang)}
        {m.synced ? '' : ` · ${t('sync.pendingOne')}`}
        {canTranslate && (
          <>
            {' · '}
            <button
              type="button"
              className="underline font-bold"
              disabled={translating}
              onClick={() => { if (m.serverId) onTranslate(m.serverId); }}
            >
              {t('chat.translate')}
            </button>
          </>
        )}
      </span>
    </li>
  );
}

/** Chat thread for one order (customer ↔ courier, auto-translated). */
export function ChatPanel(args: { orderId: string }) {
  const { t } = useTranslation();
  useLiveChat({ orderId: args.orderId });
  const thread = useChat({ orderId: args.orderId });
  const send = useSendChat({ orderId: args.orderId });
  const translate = useTranslateChat({ orderId: args.orderId, lang: i18n.language });
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');

  async function sendText(text: string, canonicalId?: QuickReplyId) {
    const clean = text.trim();
    if (clean.length === 0) return;
    setErr('');
    try {
      await send.mutateAsync({ text: clean, canonicalId });
      setDraft('');
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function onTranslate(messageId: string) {
    setErr('');
    try {
      await translate.mutateAsync(messageId);
    } catch {
      setErr(t('chat.translateFailed'));
    }
  }

  return (
    <section className="tb-total mt-3" aria-label={t('chat.title')}>
      <h2 className="tb-h2">{t('chat.title')}</h2>
      <p className="tb-sub">{t('chat.sub')}</p>
      {thread.isLoading && (
        <div className="flex flex-col gap-2 mt-2"><Skeleton height={44} /><Skeleton height={44} /></div>
      )}
      {thread.isError && (
        <div className="mt-2 flex flex-col gap-2">
          <Note tone="error">{t('common.error')}</Note>
          <Button variant="soft" size="sm" onClick={() => void thread.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      {thread.data && thread.data.length === 0 && (
        <p className="tb-sub mt-2">{t('chat.empty')}</p>
      )}
      {thread.data && thread.data.length > 0 && (
        <ol className="tb-chat mt-2" aria-live="polite">
          {thread.data.map((m) => (
            <MessageRow key={m.id} m={m} t={t} onTranslate={(id) => void onTranslate(id)} translating={translate.isPending} />
          ))}
        </ol>
      )}
      <div className="tb-chips mt-2" aria-label={t('chat.quick')}>
        {QUICK_REPLY_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="tb-chip"
            disabled={send.isPending}
            onClick={() => void sendText(quickText(id, t), id)}
          >
            {quickText(id, t)}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendText(draft);
        }}
      >
        <label className="flex-1" aria-label={t('chat.title')}>
          <input
            className="tb-input"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('chat.placeholder')}
          />
        </label>
        <Button type="submit" variant="ember" disabled={draft.trim().length === 0 || send.isPending}>
          {t('chat.send')}
        </Button>
      </form>
      {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}
    </section>
  );
}
