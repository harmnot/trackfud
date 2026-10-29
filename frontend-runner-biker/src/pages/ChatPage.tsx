/**
 * Runner/biker ↔ customer chat, text first: messages load from the API
 * (`GET /courier/deliveries/{id}/messages`) for the active delivery.
 * Quick replies are input shortcuts only — never stored thread data.
 * Voice notes record on-device; server translation applies per message.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Note, Page } from '../components/ui';
import { QUICK_REPLIES, useChat } from '../features/chat/chatStore';
import { useDelivery } from '../features/delivery/deliveryStore';
import { db } from '../lib/db';
import { logger } from '../lib/logger';
import i18n from '../i18n';

export function ChatPage(): React.JSX.Element {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const loaded = useChat((s) => s.loaded);
  const chatError = useChat((s) => s.error);
  const deliveryId = useDelivery((s) => s.active?.deliveryId ?? null);
  const [text, setText] = useState('');
  const [recState, setRecState] = useState<'idle' | 'rec' | 'unsupported'>('idle');
  const [recSecs, setRecSecs] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; startedAt: number } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const lang = (['en', 'id', 'ms'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'id' | 'ms';

  useEffect(() => {
    void useChat.getState().load({ deliveryId });
  }, [deliveryId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (recState !== 'rec') return;
    const timer = window.setInterval(() => {
      const started = rec.current?.startedAt;
      if (started) setRecSecs(Math.round((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recState]);

  async function send(): Promise<void> {
    const line = text.trim();
    if (line.length === 0) return;
    setText('');
    await useChat.getState().send({ deliveryId, text: line, lang });
  }

  function startNote(): void {
    const MR = window.MediaRecorder;
    if (!MR || !navigator.mediaDevices?.getUserMedia) {
      setRecState('unsupported');
      return;
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MR(stream);
        const chunks: Blob[] = [];
        mr.ondataavailable = (ev: BlobEvent) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        mr.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          const secs = Math.max(1, Math.round((Date.now() - (rec.current?.startedAt ?? Date.now())) / 1000));
          void db.voiceNotes.add({ id: crypto.randomUUID(), ts: Date.now(), durationS: secs, audio: blob }).catch((err: unknown) => logger.warn('voice note save failed', err));
          void useChat.getState().send({ deliveryId, text: `${secs}s voice note (on this device)`, lang });
          setRecSecs(0);
          setRecState('idle');
        };
        rec.current = { mr, chunks, startedAt: Date.now() };
        mr.start();
        setRecState('rec');
        setRecSecs(0);
      } catch (err) {
        logger.warn('voice note mic denied', err);
        setRecState('unsupported');
      }
    })();
  }

  function stopNote(): void {
    try {
      rec.current?.mr.stop();
    } catch {
      setRecState('idle');
    }
    rec.current = null;
  }

  if (!deliveryId) {
    return (
      <Page>
        <h1 className="tb-display">{t('chat.title')}</h1>
        <div className="tb-card mt-3">
          <p className="font-bold">{t('chat.noDelivery')}</p>
          <p className="tb-sub mt-1">{t('chat.noDeliveryBody')}</p>
          <div className="mt-3 flex flex-col gap-2">
            <Link to="/run-setup" className="tb-btn tb-btn-pine tb-btn-block">{t('account.startTracking')}</Link>
            <Link to="/delivery" className="tb-btn tb-btn-soft tb-btn-block">{t('nav.delivery')}</Link>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <h1 className="tb-display">{t('chat.title')}</h1>
      <p className="tb-sub">{t('chat.offline')}</p>
      {!loaded && <p className="tb-sub mt-2">{t('common.loading')}</p>}
      {loaded && chatError && (
        <div className="mt-2 flex flex-col gap-2">
          <Note tone="error">{t('chat.errorLoad')}</Note>
          <Button variant="soft" block onClick={() => void useChat.getState().load({ deliveryId })}>{t('common.retry')}</Button>
        </div>
      )}
      <div className="tb-chat mt-3" role="log" aria-label={t('chat.title')}>
        {messages.map((m) => {
          const shown = m.translated ?? (lang === m.lang ? m.text : m.text);
          const needsTranslate = !m.mine && lang !== m.lang && !m.translated;
          return (
            <div key={m.id} className={`tb-chat-msg${m.mine ? ' mine' : ''}`}>
              <p>{shown}</p>
              {m.translated && (
                <small className="tb-sub">{m.translatedLive ? t('chat.translatedLive') : t('chat.translated')}</small>
              )}
              {needsTranslate && (
                <button
                  type="button"
                  className="tb-sub underline"
                  onClick={() => void useChat.getState().translate({ deliveryId, messageId: m.id, to: lang })}
                >
                  {t('chat.translate')}
                </button>
              )}
              {!m.synced && <small className="tb-sub"> · {t('chat.localOnly')}</small>}
            </div>
          );
        })}
        {loaded && messages.length === 0 && <p className="tb-sub">{t('chat.empty')}</p>}
        <div ref={bottom} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('chat.quick')}>
        {QUICK_REPLIES.map((q) => (
          <Button key={q.key} variant="soft" onClick={() => void useChat.getState().send({ deliveryId, text: lang === 'id' ? q.id : lang === 'ms' ? q.ms : q.en, lang })}>
            {lang === 'id' ? q.id : lang === 'ms' ? q.ms : q.en}
          </Button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="tb-input flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={280}
          aria-label={t('chat.placeholder')}
        />
        <Button type="submit" variant="sun">{t('chat.send')}</Button>
      </form>
      <div className="mt-2">
        {recState === 'idle' && <Button variant="soft" block onClick={startNote}>🎤 {t('chat.voiceNote')}</Button>}
        {recState === 'rec' && <Button variant="danger" block onClick={stopNote}>■ {t('chat.stopNote')} ({recSecs}s)</Button>}
        {recState === 'unsupported' && <Note tone="error">{t('chat.noMic')}</Note>}
      </div>
    </Page>
  );
}
