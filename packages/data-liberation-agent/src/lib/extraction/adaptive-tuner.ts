export interface AdaptiveTunerConfig {
  pageDelayMin?: number;
  pageDelayMax?: number;
  pageDelayIncrease?: number;
  mediaConcurrencyMin?: number;
  mediaConcurrencyMax?: number;
  mediaConcurrencyIncrease?: number;
}

export interface TunerTrackState {
  currentValue: number;
  throughputEma: number | null;
  errorBackoffRemaining: number;
}

export interface TunerState {
  page: TunerTrackState;
  media: TunerTrackState;
}

export type TunerDecision = 'warmup' | 'error_backoff' | 'increase' | 'decrease' | 'skip';

const TUNER_DEFAULTS = {
  throughputEmaAlpha: 0.2,
  aimdDropRatio: 0.9,
  aimdDecreaseFactor: 0.7,
  errorDecreaseFactor: 0.5,
  errorBackoffRequests: 3,

  pageDelayMin: 50,
  pageDelayMax: 10_000,
  pageDelayIncrease: 50,

  mediaConcurrencyMin: 1,
  mediaConcurrencyMax: 12,
  mediaConcurrencyIncrease: 1,
  mediaConcurrencyStart: 6,

  mediaErrorMinCount: 2,
  mediaErrorRatio: 0.5,
} as const;

export { TUNER_DEFAULTS };

interface Track {
  currentValue: number;
  throughputEma: number | null;
  errorBackoffRemaining: number;
  min: number;
  max: number;
  additiveIncrease: number;
  invertDirection: boolean;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function restoreTrackState(
  saved: TunerTrackState | undefined,
  defaultValue: number,
  min: number,
  max: number,
  additiveIncrease: number,
  invertDirection: boolean,
): Track {
  const track: Track = {
    currentValue: defaultValue,
    throughputEma: null,
    errorBackoffRemaining: 0,
    min,
    max,
    additiveIncrease,
    invertDirection,
  };

  if (!saved) return track;

  if (isFiniteNumber(saved.currentValue)) {
    track.currentValue = Math.max(min, Math.min(max, saved.currentValue));
  }
  if (saved.throughputEma === null) {
    track.throughputEma = null;
  } else if (isFiniteNumber(saved.throughputEma) && saved.throughputEma > 0) {
    track.throughputEma = saved.throughputEma;
  }

  if (isFiniteNumber(saved.errorBackoffRemaining)) {
    track.errorBackoffRemaining = Math.max(
      0,
      Math.min(TUNER_DEFAULTS.errorBackoffRequests, Math.floor(saved.errorBackoffRemaining)),
    );
  }

  return track;
}

export class AdaptiveTuner {
  private page: Track;
  private media: Track;
  lastDebug: {
    track: string;
    elapsed: number;
    workDone: number;
    throughput: number;
    ema: number | null;
    ratio: number | null;
    decision: TunerDecision;
  } | null = null;

  constructor(
    opts: { pageDelayStart: number; config?: AdaptiveTunerConfig },
    savedState?: TunerState,
  ) {
    const c = opts.config ?? {};
    const pageMin = c.pageDelayMin ?? TUNER_DEFAULTS.pageDelayMin;
    const pageMax = c.pageDelayMax ?? TUNER_DEFAULTS.pageDelayMax;
    const pageInc = c.pageDelayIncrease ?? TUNER_DEFAULTS.pageDelayIncrease;
    const mediaMin = c.mediaConcurrencyMin ?? TUNER_DEFAULTS.mediaConcurrencyMin;
    const mediaMax = c.mediaConcurrencyMax ?? TUNER_DEFAULTS.mediaConcurrencyMax;
    const mediaInc = c.mediaConcurrencyIncrease ?? TUNER_DEFAULTS.mediaConcurrencyIncrease;

    this.page = restoreTrackState(
      savedState?.page,
      opts.pageDelayStart,
      pageMin,
      pageMax,
      pageInc,
      true,
    );

    this.media = restoreTrackState(
      savedState?.media,
      TUNER_DEFAULTS.mediaConcurrencyStart,
      mediaMin,
      mediaMax,
      mediaInc,
      false,
    );
  }

  getPageDelay(): number {
    return Math.round(this.page.currentValue);
  }

  getMediaConcurrency(): number {
    return Math.round(this.media.currentValue);
  }

  getPageConcurrency(): number {
    const delay = this.getPageDelay();
    if (delay < 200) return 3;
    if (delay < 500) return 2;
    return 1;
  }

  getState(): TunerState {
    return {
      page: {
        currentValue: this.page.currentValue,
        throughputEma: this.page.throughputEma,
        errorBackoffRemaining: this.page.errorBackoffRemaining,
      },
      media: {
        currentValue: this.media.currentValue,
        throughputEma: this.media.throughputEma,
        errorBackoffRemaining: this.media.errorBackoffRemaining,
      },
    };
  }

  private updateTrack(track: Track, elapsed: number, workDone: number, trackName: string): TunerDecision {
    if (elapsed <= 0) {
      this.lastDebug = { track: trackName, elapsed, workDone, throughput: 0, ema: track.throughputEma, ratio: null, decision: 'skip' };
      return 'skip';
    }

    const throughput = workDone / elapsed;

    if (track.throughputEma === null) {
      track.throughputEma = throughput;
      if (track.errorBackoffRemaining > 0) {
        track.errorBackoffRemaining--;
      }
      this.lastDebug = { track: trackName, elapsed, workDone, throughput, ema: throughput, ratio: null, decision: 'warmup' };
      return 'warmup';
    }

    const ratio = throughput / track.throughputEma;
    track.throughputEma =
      track.throughputEma * (1 - TUNER_DEFAULTS.throughputEmaAlpha) +
      throughput * TUNER_DEFAULTS.throughputEmaAlpha;

    if (track.errorBackoffRemaining > 0) {
      track.errorBackoffRemaining--;
      this.lastDebug = { track: trackName, elapsed, workDone, throughput, ema: track.throughputEma, ratio, decision: 'error_backoff' };
      return 'error_backoff';
    }

    let decision: TunerDecision;
    if (ratio < TUNER_DEFAULTS.aimdDropRatio) {
      if (track.invertDirection) {
        track.currentValue *= 1 / TUNER_DEFAULTS.aimdDecreaseFactor;
      } else {
        track.currentValue *= TUNER_DEFAULTS.aimdDecreaseFactor;
      }
      decision = 'decrease';
    } else {
      if (track.invertDirection) {
        track.currentValue -= track.additiveIncrease;
      } else {
        track.currentValue += track.additiveIncrease;
      }
      decision = 'increase';
    }

    track.currentValue = Math.max(track.min, Math.min(track.max, track.currentValue));
    this.lastDebug = { track: trackName, elapsed, workDone, throughput, ema: track.throughputEma, ratio, decision };
    return decision;
  }

  private applyError(track: Track): void {
    if (track.invertDirection) {
      track.currentValue *= 1 / TUNER_DEFAULTS.errorDecreaseFactor;
    } else {
      track.currentValue *= TUNER_DEFAULTS.errorDecreaseFactor;
    }
    track.currentValue = Math.max(track.min, Math.min(track.max, track.currentValue));
    track.errorBackoffRemaining = TUNER_DEFAULTS.errorBackoffRequests;
    track.throughputEma = null;
  }

  recordPageResult(result: { elapsed: number }): TunerDecision {
    return this.updateTrack(this.page, result.elapsed, 1, 'page');
  }

  recordPageError(): void {
    this.applyError(this.page);
  }

  recordMediaResult(result: { elapsed: number; bytesDownloaded: number }): TunerDecision {
    return this.updateTrack(this.media, result.elapsed, result.bytesDownloaded, 'media');
  }

  recordMediaError(): void {
    this.applyError(this.media);
  }
}
