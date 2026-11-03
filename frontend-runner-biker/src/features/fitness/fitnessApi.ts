/** Fitness-test API: config + application + submit (all from the server, no mocks). */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';

export interface FitnessConfig {
  fitness: {
    runner_distance_m: number;
    runner_moving_limit_s: number;
    biker_distance_m: number;
    biker_moving_limit_s: number;
  };
}

export interface CourierApplication {
  mode: string;
  status: string;
  reject_reason?: string;
  draft?: Record<string, unknown>;
  submitted_at?: string | null;
  updated_at?: string | null;
  fitness?: {
    distance_m: number;
    moving_s: number;
    elapsed_s: number;
    passed: boolean;
    flags?: string[];
    max_gap_s?: number;
    checkpoints?: number;
  };
}

export interface FitnessSubmitResult {
  passed: boolean;
  target_distance_m?: number;
  moving_limit_s?: number;
  distance_m?: number;
  moving_s?: number;
  elapsed_s?: number;
}

export interface ApplicationSubmitResult {
  status: string;
}

/** Public fitness thresholds (runner/biker distance + moving limits). */
export async function fetchFitnessConfig(): Promise<FitnessConfig> {
  try {
    return await api<FitnessConfig>('/config/public');
  } catch (e) {
    logger.warn('fetchFitnessConfig failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Caller's application incl. last fitness evaluation (null-safe). */
export async function fetchCourierApplication(): Promise<CourierApplication> {
  try {
    return await api<CourierApplication>('/courier/application');
  } catch (e) {
    logger.warn('fetchCourierApplication failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Submit a recorded track for evaluation (server decides pass/fail). */
export async function submitFitnessTest(params: {
  mode: 'runner' | 'biker';
  distanceM: number;
  movingS: number;
  elapsedS: number;
  points: number;
}): Promise<FitnessSubmitResult> {
  try {
    return await api<FitnessSubmitResult>('/courier/fitness-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: params.mode,
        distance_m: Math.round(params.distanceM),
        moving_s: params.movingS,
        elapsed_s: params.elapsedS,
        points: params.points,
      }),
    });
  } catch (e) {
    logger.warn('submitFitnessTest failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Submit the partner application for CMS review (requires passed fitness + profile). */
export async function submitCourierApplication(): Promise<ApplicationSubmitResult> {
  try {
    return await api<ApplicationSubmitResult>('/courier/application/submit', { method: 'POST' });
  } catch (e) {
    logger.warn('submitCourierApplication failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}
