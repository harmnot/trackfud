/**
 * Voice Copilot panel: hold-to-talk button, live status, last transcript +
 * parsed reply, and the honestly-labelled transport badge (B6 relay when
 * open, local EN+ID parser otherwise). Text box mirrors the mic path so
 * the parser works on desktop and on phones without recognizer support.
 */
import { useState } from 'react';
import { Button, Note, TextInput } from './ui';
import { VOICE_HINTS } from '../features/voice/voiceCommands';
import { VOICE_BACKEND } from '../features/voice/useVoiceCopilot';

type Props = {
  phase: 'idle' | 'listening' | 'unsupported';
  pcmBytes: number;
  /** True while the B6 relay owns transcription (else the local parser). */
  serverVoice?: boolean;
  lastHeard: string | null;
  lastReply: string | null;
  micError: string | null;
  labels: {
    hold: string;
    release: string;
    heard: string;
    reply: string;
    typedPlaceholder: string;
    send: string;
    fallback: string;
    server: string;
    denied: string;
  };
  onHold: () => void;
  onRelease: () => void;
  onType: (text: string) => void;
};

/** Hold-to-talk control with transcript + transport honesty badge. */
export function VoicePanel(props: Props): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const listening = props.phase === 'listening';
  return (
    <section className="tb-card mt-3" aria-label="Voice Copilot">
      <p className="text-sm font-bold">🎙 Voice Copilot</p>
      <p className="tb-sub mt-1">{VOICE_HINTS.join(' · ')}</p>
      <div className="mt-2">
        <Button
          block
          variant={listening ? 'danger' : 'sun'}
          onClick={() => {
            if (listening) props.onRelease();
            else props.onHold();
          }}
        >
          {listening ? props.labels.release : props.labels.hold}
        </Button>
      </div>
      {listening && <p className="tb-sub mt-2" role="status">● {(props.pcmBytes / 1024).toFixed(1)} KB PCM 24 kHz…</p>}
      {props.lastHeard && (
        <p className="tb-sub mt-2">{props.labels.heard}: “{props.lastHeard}”</p>
      )}
      {props.lastReply && (
        <p className="mt-1 font-bold">{props.labels.reply}: {props.lastReply}</p>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim().length > 0) {
            props.onType(typed);
            setTyped('');
          }
        }}
      >
        <div className="flex-1">
          <TextInput
            value={typed}
            onChange={setTyped}
            placeholder={props.labels.typedPlaceholder}
            aria-label={props.labels.typedPlaceholder}
          />
        </div>
        <Button type="submit" variant="soft">{props.labels.send}</Button>
      </form>
      <div className="mt-2">
        <Note tone="info">{(props.serverVoice ?? VOICE_BACKEND === 'server') ? props.labels.server : props.labels.fallback}</Note>
      </div>
      {props.micError && (
        <div className="mt-2">
          <Note tone="error">{props.labels.denied}</Note>
        </div>
      )}
    </section>
  );
}
