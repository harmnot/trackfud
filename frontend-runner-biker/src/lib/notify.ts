/**
 * Offer alerts: sound + vibration + speech. Audio unlocks on the explicit
 * "Go online" tap (browsers block audio before interaction); every method
 * degrades silently when the device denies it.
 */
import { logger } from './logger';

let audioCtx: AudioContext | null = null;
let unlocked = false;

/** Call from the "Go online" tap so later alerts may play sound. */
export function unlockAudio(): void {
  unlocked = true;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    void audioCtx.resume();
  } catch (err) {
    logger.warn('audio unlock failed', err);
  }
}

/** Two-tone offer chime (WebAudio, no asset needed). */
export function playOfferSound(): void {
  if (!unlocked) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    void audioCtx.resume();
    const now = audioCtx.currentTime;
    for (const [offset, freq] of [[0, 660], [0.18, 880]] as const) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, now + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    }
  } catch (err) {
    logger.warn('offer sound failed', err);
  }
}

/** Short vibration burst for offers (Android; iOS Safari ignores it). */
export function vibrateOffer(): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  } catch {
    /* vibration unsupported: sound + push still fire */
  }
}

export type SpeakLang = 'en' | 'id' | 'ms';

const VOICE_LOCALE: Record<SpeakLang, string> = { en: 'en-GB', id: 'id-ID', ms: 'ms-MY' };

/** Speak one short line (offer summary, nudge, cheer, pace cue). */
export function speak(text: string, args: { lang: SpeakLang }): void {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(text);
    line.lang = VOICE_LOCALE[args.lang];
    line.rate = 1.05;
    window.speechSynthesis.speak(line);
  } catch (err) {
    logger.warn('speech failed', err);
  }
}

/** Stop any spoken line (e.g. offer answered, session ended). */
export function stopSpeaking(): void {
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch {
    /* nothing to stop */
  }
}

/** Fire sound + vibration + voice together for an incoming offer. */
export function alertOffer(args: { line: string; lang: SpeakLang }): void {
  playOfferSound();
  vibrateOffer();
  speak(args.line, { lang: args.lang });
}
