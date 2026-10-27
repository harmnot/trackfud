/** Huge Run Mode stats: distance · time · pace · active min · earnings. */
import { formatDistance, formatDuration, formatMoney, formatPace, formatSpeed } from '../lib/format';
import { Stat } from './ui';

type Props = {
  distanceM: number;
  movingS: number;
  activeS: number;
  mode: 'runner' | 'biker';
  earningsMinor: number;
  currency: string;
  locale: string;
  units: 'km' | 'mi';
  labels: { distance: string; time: string; pace: string; active: string; earned: string };
};

/** Big-number grid, readable at arm's length while moving. */
export function RunStats(props: Props) {
  const pace =
    props.mode === 'runner'
      ? formatPace(props.movingS, props.distanceM, props.units)
      : formatSpeed(props.movingS, props.distanceM, props.units);
  return (
    <div>
      <p className="tb-run-hero" aria-live="polite">
        {formatDistance(props.distanceM, { locale: props.locale, units: props.units })}
      </p>
      <p className="tb-run-clock">{formatDuration(props.movingS)}</p>
      <div className="tb-stats mt-3">
        <Stat value={pace} label={props.labels.pace} />
        <Stat value={`${Math.floor(props.activeS / 60)}′`} label={props.labels.active} />
        <Stat
          value={formatMoney(props.earningsMinor, props.currency, props.locale)}
          label={props.labels.earned}
        />
      </div>
    </div>
  );
}
