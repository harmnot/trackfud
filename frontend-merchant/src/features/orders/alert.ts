/**
 * Kitchen alarm: loud repeating klaxon + vibration + speech. Audio unlocks on
 * the explicit "Start receiving orders" tap (browsers block audio before
 * interaction); every method degrades silently when the device denies it.
 */
import { logger } from '../../lib/logger';

let audioCtx: AudioContext | null = null;
let unlocked = false;
let alarmTimer: number | null = null;

const ALARM_REPEATS = 3;
const ALARM_GAP_MS = 900;

/** Call from the "Start receiving orders" tap so later alerts may play sound. */
export function unlockKitchenAudio(): void {
  unlocked = true;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    void audioCtx.resume();
  } catch (err) {
    logger.warn('kitchen audio unlock failed', { err: err instanceof Error ? err.message : 'unknown' });
  }
}

/** One loud two-blast klaxon (square wave cuts through kitchen noise). */
function blastOnce(): void {
  if (!unlocked) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    void audioCtx.resume();
    const now = audioCtx.currentTime;
    for (const [offset, freq] of [[0, 880], [0.22, 1100], [0.44, 880]] as const) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.25);
    }
  } catch (err) {
    logger.warn('kitchen alarm failed', { err: err instanceof Error ? err.message : 'unknown' });
  }
}

/** Loud alarm, repeated so it is unmissable in a noisy kitchen. */
export function playKitchenAlarm(): void {
  stopKitchenAlarm();
  blastOnce();
  let left = ALARM_REPEATS - 1;
  alarmTimer = window.setInterval(() => {
    if (left <= 0) {
      stopKitchenAlarm();
      return;
    }
    left -= 1;
    blastOnce();
  }, ALARM_GAP_MS);
  try {
    if ('vibrate' in navigator) navigator.vibrate([400, 200, 400, 200, 400]);
  } catch {
    /* vibration unsupported: sound + push still fire */
  }
}

/** Silence the repeating alarm (order answered or receiving stopped). */
export function stopKitchenAlarm(): void {
  if (alarmTimer !== null) window.clearInterval(alarmTimer);
  alarmTimer = null;
}

export type KitchenLang = 'en' | 'id' | 'ms';

const VOICE_LOCALE: Record<KitchenLang, string> = { en: 'en-GB', id: 'id-ID', ms: 'ms-MY' };

/** Speak one short line (new-order summary). Never blocks the alarm. */
export function speakKitchen(params: { text: string; lang: KitchenLang }): void {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(params.text);
    line.lang = VOICE_LOCALE[params.lang];
    line.rate = 1.0;
    window.speechSynthesis.speak(line);
  } catch (err) {
    logger.warn('kitchen speech failed', { err: err instanceof Error ? err.message : 'unknown' });
  }
}
