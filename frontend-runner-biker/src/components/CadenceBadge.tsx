/** Step-cadence badge for runners (P1 signal): steps + steps/min. */
import { Button } from './ui';

type Props = {
  mode: 'runner' | 'biker';
  supported: boolean;
  steps: number;
  spm: number;
  labels: { title: string; enable: string; steps: string; unavailable: string };
  onEnable: () => void;
};

/** Cadence readout; hidden-by-design for bikers, opt-in for runners. */
export function CadenceBadge(props: Props): React.JSX.Element | null {
  if (props.mode !== 'runner') return null;
  if (!props.supported) {
    return (
      <div className="tb-card mt-3">
        <p className="text-sm font-bold">{props.labels.title}</p>
        <p className="tb-sub mt-1">{props.labels.unavailable}</p>
        <div className="mt-2"><Button variant="soft" block onClick={props.onEnable}>{props.labels.enable}</Button></div>
      </div>
    );
  }
  return (
    <div className="tb-card mt-3" aria-live="polite">
      <p className="text-sm font-bold">{props.labels.title}</p>
      <p className="tb-run-hero">{props.spm} <small>spm</small></p>
      <p className="tb-sub">{props.steps} {props.labels.steps}</p>
    </div>
  );
}
