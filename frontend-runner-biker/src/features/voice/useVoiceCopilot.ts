/**
 * Voice Copilot capture hook: hold-to-talk mic → AudioWorklet 24 kHz Int16
 * PCM → B6 server relay (`GET /courier/voice`), with the local EN+ID
 * parser in `voiceCommands` as the no-key/offline fallback. While the
 * relay is open, PCM frames stream as binary WS messages and server
 * `voice.intent` frames arrive via `onServerIntent`; the on-device
 * recognizer stays off so one utterance is never acted on twice. When the
 * relay is down, capture is still real (byte-counted, mic-permission
 * honest) and the transcript comes from the on-device recognizer or the
 * typed box, then the local parser owns the intent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../../lib/logger';
import { stopSpeaking } from '../../lib/notify';
import type { VoiceIntentFrame } from '../delivery/courierApi';
import { voiceRelay } from './voiceRelay';

/** Transport for voice audio. `'server'` is the B6 relay, live now. */
export type VoiceBackend = 'server' | 'local-fallback';

/** Backend voice endpoint (openapi `voiceConnect` + `voiceConfirm`). */
export const VOICE_WS_PATH = '/v1/courier/voice';

/** Current transport. The relay is tried first; local parser on failure. */
export const VOICE_BACKEND: VoiceBackend = 'server';

/** True when the mic path streams to the server (false = local fallback). */
export function isServerVoice(): boolean {
  return VOICE_BACKEND === 'server';
}

export type VoicePhase = 'idle' | 'listening' | 'unsupported';

const PCM_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs && inputs[0] && inputs[0][0];
    if (ch) {
      const out = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i += 1) {
        const v = Math.max(-1, Math.min(1, ch[i]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('tb-pcm', PcmCapture);
`;

type CopilotArgs = {
  /** Called with the final transcript line (recognizer or typed fallback). */
  onTranscript: (text: string) => void;
  /** Called when the mic cannot be opened (permission, HTTP, no device). */
  onMicError: (reason: string) => void;
  /** Called with each server `voice.intent` frame while the relay is open. */
  onServerIntent?: (frame: VoiceIntentFrame) => void;
};

/** Hold-to-talk capture: pause TTS while listening, count real PCM bytes. */
export function useVoiceCopilot(args: CopilotArgs): {
  phase: VoicePhase;
  pcmBytes: number;
  serverVoice: boolean;
  startTalk: () => void;
  stopTalk: () => void;
} {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [pcmBytes, setPcmBytes] = useState(0);
  const [serverVoice, setServerVoice] = useState(false);
  const onTxRef = useRef(args.onTranscript);
  onTxRef.current = args.onTranscript;
  const onErrRef = useRef(args.onMicError);
  onErrRef.current = args.onMicError;
  const onIntentRef = useRef(args.onServerIntent);
  onIntentRef.current = args.onServerIntent;
  const relayOpenRef = useRef(false);
  const sentFramesRef = useRef(0);
  const rig = useRef<{ stream: MediaStream; ctx: AudioContext; url: string } | null>(null);
  const recog = useRef<{ stop: () => void; abort: () => void } | null>(null);

  useEffect(() => {
    relayOpenRef.current = false;
    sentFramesRef.current = 0;
    void voiceRelay
      .connect({
        onIntent: (frame) => onIntentRef.current?.(frame),
        onClose: () => {
          relayOpenRef.current = false;
          setServerVoice(false);
        },
      })
      .then((ok) => {
        relayOpenRef.current = ok;
        setServerVoice(ok);
      });
    return () => {
      voiceRelay.close();
      relayOpenRef.current = false;
    };
  }, []);

  const stopTalk = useCallback(() => {
    try {
      recog.current?.stop();
    } catch {
      /* recognizer already gone */
    }
    recog.current = null;
    const r = rig.current;
    rig.current = null;
    if (r) {
      for (const t of r.stream.getTracks()) t.stop();
      void r.ctx.close().catch(() => undefined);
      URL.revokeObjectURL(r.url);
    }
    // Close the utterance so the server transcribes the streamed PCM.
    if (relayOpenRef.current && sentFramesRef.current > 0) voiceRelay.endUtterance();
    sentFramesRef.current = 0;
    setPhase('idle');
  }, []);

  useEffect(() => stopTalk, [stopTalk]);

  const startTalk = useCallback(() => {
    if (rig.current) return;
    stopSpeaking();
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      onErrRef.current('mic-unsupported');
      setPhase('unsupported');
      return;
    }
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (err) {
        logger.warn('voice mic denied', err);
        onErrRef.current('mic-denied');
        return;
      }
      setPhase('listening');
      setPcmBytes(0);
      sentFramesRef.current = 0;
      // Real 24 kHz Int16 PCM path: resample in the context, stream to
      // the relay when open, always byte-count for the honesty badge.
      try {
        const ctx = new AudioContext({ sampleRate: 24000 });
        await ctx.resume();
        const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, 'tb-pcm');
        node.port.onmessage = (ev: MessageEvent) => {
          const buf = ev.data as ArrayBuffer;
          setPcmBytes((b) => b + buf.byteLength);
          if (relayOpenRef.current && voiceRelay.sendPcm(buf)) sentFramesRef.current += 1;
        };
        src.connect(node);
        rig.current = { stream, ctx, url };
      } catch (err) {
        logger.warn('pcm worklet failed, mic still held for recognizer', err);
        rig.current = { stream, ctx: new AudioContext(), url: '' };
      }
      // Local transcript only while the relay is down — otherwise the
      // server transcript (voice.end → voice.intent) owns the utterance.
      // The typed box in VoicePanel feeds `onTranscript` either way.
      if (relayOpenRef.current) return;
      try {
        const w = window as unknown as {
          SpeechRecognition?: new () => WebSpeechRecognizer;
          webkitSpeechRecognition?: new () => WebSpeechRecognizer;
        };
        const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
        if (!Ctor) return;
        const r = new Ctor();
        r.lang = 'id-ID';
        r.interimResults = false;
        r.maxAlternatives = 1;
        r.onresult = (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
          const line = ev.results[0]?.[0]?.transcript ?? '';
          if (line.trim().length > 0) onTxRef.current(line);
        };
        r.onerror = (ev: { error?: string }) => logger.warn('recognizer error', ev.error);
        recog.current = r;
        r.start();
      } catch (err) {
        logger.warn('recognizer unavailable, typed fallback stays', err);
      }
    })();
  }, []);

  return { phase, pcmBytes, serverVoice, startTalk, stopTalk };
}

type WebSpeechRecognizer = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
