/**
 * AI Run Planner page: mode + goal + PlannerPanel. Picking a loop stores it
 * on-device; Run Setup (track = AI-planned) sends its GeoJSON as
 * `planned_track` so dispatch scores the corridor. Workout-first copy:
 * estimates are chances, never promises.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Field, Page, RadioGroup } from '../components/ui';
import { PlannerPanel } from '../features/planner/PlannerPanel';
import { usePlan } from '../features/planner/planStore';
import type { CourierMode } from '../lib/format';

export function PlannerPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CourierMode>('runner');
  const [goalM, setGoalM] = useState(5000);
  const picked = usePlan((s) => s.picked);
  const pick = usePlan((s) => s.pick);

  return (
    <Page>
      <h1 className="tb-display">{t('planner.title')}</h1>
      <p className="tb-sub">{t('planner.intro')}</p>
      <div className="mt-3">
        <RadioGroup
          name="plan-mode"
          label={t('onboard.mode')}
          value={mode}
          onChange={(v) => setMode(v as CourierMode)}
          options={[
            { value: 'runner', label: t('onboard.runner') },
            { value: 'biker', label: t('onboard.biker') },
          ]}
        />
      </div>
      <div className="mt-3">
        <Field label={t('run.target')}>
          <RadioGroup
            name="plan-goal"
            label={t('run.target')}
            value={String(goalM)}
            onChange={(v) => setGoalM(Number(v))}
            options={[
              { value: '3000', label: '3 km' },
              { value: '5000', label: '5 km' },
              { value: '10000', label: '10 km' },
            ]}
          />
        </Field>
      </div>
      <div className="mt-3">
        <PlannerPanel mode={mode} goalDistanceM={goalM} onPick={pick} pickedId={picked?.id ?? null} />
      </div>
      {picked && (
        <div className="mt-3 flex flex-col gap-2">
          <Link to="/run-setup" className="tb-btn tb-btn-pine tb-btn-block">
            {t('planner.startWith', { name: picked.name })}
          </Link>
          <Button block variant="soft" onClick={() => pick(null)}>{t('planner.clear')}</Button>
        </div>
      )}
    </Page>
  );
}
