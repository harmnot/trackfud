/**
 * Voice Copilot local command parser (EN + ID). This is the clearly-labelled
 * fallback behind the single swap point in `useVoiceCopilot`: when the
 * backend voice WebSocket (`VOICE_WS_PATH`) exists, transcripts come from
 * `muse-voice-transcribe` server-side; until then this parser owns the
 * intents `accept`, `how far?` and `I'm 2 min away`. Case-insensitive,
 * code-switching friendly (mixed Indonesian + English in one line works).
 */

/** Hands-free intents the Copilot can act on while the courier moves. */
export type VoiceIntent =
  | { kind: 'accept' }
  | { kind: 'decline' }
  | { kind: 'howFar' }
  | { kind: 'etaSoon' }
  | { kind: 'repeat' }
  | { kind: 'unknown' };

type Pattern = { re: RegExp; intent: VoiceIntent };

const PATTERNS: readonly Pattern[] = [
  { re: /\b(accept|accepts|accepted|take it|take order|yes|yeah|ok(ay)? go|gas|terima|ya|iya|ambil|oke gas)\b/, intent: { kind: 'accept' } },
  { re: /\b(decline|reject|no thanks?|skip|no\b.*offer|tolak|tidak|nggak|enggak|nanti (aja|dulu))\b/, intent: { kind: 'decline' } },
  { re: /\b(how far|how long|distance|jarak|berapa (jauh|jarak|lama)|tinggal berapa|where.*(pickup|resto|merchant)|di mana.*resto)\b/, intent: { kind: 'howFar' } },
  { re: /\b(2\s?min|two min|almost (there|here)|arriving|on my way|otw|sampai|dua menit|sebentar lagi|hampir sampai|mau sampai)\b/, intent: { kind: 'etaSoon' } },
  { re: /\b(repeat|again|say again|sekali lagi|ulangi|ulang)\b/, intent: { kind: 'repeat' } },
];

/** Normalize a raw transcript line for matching (lowercase, trim, unpunctuated). */
export function normalizeTranscript(text: string): string {
  return text.toLowerCase().replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parse one transcript line into a hands-free intent (EN + ID). */
export function parseVoiceCommand(args: { text: string }): VoiceIntent {
  const line = normalizeTranscript(args.text);
  if (line.length === 0) return { kind: 'unknown' };
  for (const p of PATTERNS) {
    if (p.re.test(line)) return p.intent;
  }
  return { kind: 'unknown' };
}

/** Example utterances shown under the hold-to-talk button (EN + ID). */
export const VOICE_HINTS: readonly string[] = [
  '“Accept” / “Terima”',
  '“How far?” / “Berapa jauh?”',
  '“I’m 2 min away” / “Dua menit sampai”',
];

type ReplyCtx = {
  merchantName: string | null;
  etaText: string | null;
  lastOfferText: string | null;
};

/**
 * Build the spoken reply for an intent. The courier hears this through the
 * same speech path as offers and cheers (see `lib/notify.speak`).
 */
export function voiceReply(args: { intent: VoiceIntent; lang: 'en' | 'id' | 'ms'; ctx: ReplyCtx }): string {
  const id = args.lang === 'id' || args.lang === 'ms';
  switch (args.intent.kind) {
    case 'accept':
      return args.ctx.merchantName
        ? id ? `Siap. Order ${args.ctx.merchantName} diterima.` : `Done. ${args.ctx.merchantName} accepted.`
        : id ? 'Siap. Order diterima.' : 'Done. Offer accepted.';
    case 'decline':
      return id ? 'Oke, tawaran dilewati. Tanpa penalti.' : 'Okay, offer skipped. No penalty.';
    case 'howFar':
      return args.ctx.etaText ?? (id ? 'Belum ada info jarak.' : 'No distance info yet.');
    case 'etaSoon':
      return id ? 'Siap, pelanggan dikabari kamu 2 menit lagi sampai.' : 'Got it, the customer hears you are 2 minutes away.';
    case 'repeat':
      return args.ctx.lastOfferText ?? (id ? 'Tidak ada tawaran aktif.' : 'No active offer.');
    case 'unknown':
      return id ? 'Maaf, coba: terima, berapa jauh, atau dua menit sampai.' : 'Sorry, try: accept, how far, or 2 minutes away.';
  }
}
