import { describe, it, expect } from 'vitest';
import { AdaptiveTuner } from './adaptive-tuner.js';

describe('AdaptiveTuner', () => {
  describe('constructor and getters', () => {
    it('uses default delay and concurrency when no saved state', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      expect(tuner.getPageDelay()).toBe(500);
      expect(tuner.getMediaConcurrency()).toBe(6);
    });

    it('uses pageDelayStart as the initial delay', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 1000 });
      expect(tuner.getPageDelay()).toBe(1000);
    });

    it('restores from valid saved state', () => {
      const saved = {
        page: { currentValue: 200, throughputEma: 3.5, errorBackoffRemaining: 0 },
        media: { currentValue: 10, throughputEma: 5000, errorBackoffRemaining: 1 },
      };
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 }, saved);
      expect(tuner.getPageDelay()).toBe(200);
      expect(tuner.getMediaConcurrency()).toBe(10);
    });

    it('clamps restored values to valid ranges', () => {
      const saved = {
        page: { currentValue: 1, throughputEma: 3.5, errorBackoffRemaining: 0 },
        media: { currentValue: 99, throughputEma: 5000, errorBackoffRemaining: 0 },
      };
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 }, saved);
      expect(tuner.getPageDelay()).toBe(50);
      expect(tuner.getMediaConcurrency()).toBe(12);
    });

    it('falls back to defaults for NaN/Infinity in saved state', () => {
      const saved = {
        page: { currentValue: NaN, throughputEma: Infinity, errorBackoffRemaining: -1 },
        media: { currentValue: 'banana' as unknown as number, throughputEma: null, errorBackoffRemaining: 0 },
      };
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 }, saved);
      expect(tuner.getPageDelay()).toBe(500);
      expect(tuner.getMediaConcurrency()).toBe(6);
    });

    it('resets negative throughputEma to null', () => {
      const saved = {
        page: { currentValue: 300, throughputEma: -5, errorBackoffRemaining: 0 },
        media: { currentValue: 6, throughputEma: 0, errorBackoffRemaining: 0 },
      };
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 }, saved);
      const decision = tuner.recordPageResult({ elapsed: 0.5 });
      expect(decision).toBe('warmup');
    });

    it('accepts per-adapter config overrides', () => {
      const tuner = new AdaptiveTuner({
        pageDelayStart: 500,
        config: { pageDelayMin: 100, mediaConcurrencyMax: 8 },
      });
      expect(tuner.getPageDelay()).toBe(500);
      expect(tuner.getMediaConcurrency()).toBe(6);
      for (let i = 0; i < 100; i++) {
        tuner.recordPageResult({ elapsed: 0.1 });
      }
      expect(tuner.getPageDelay()).toBeGreaterThanOrEqual(100);
    });
  });

  describe('AIMD — page track', () => {
    it('returns warmup on first result and seeds EMA without changing delay', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      const initialDelay = tuner.getPageDelay();
      const decision = tuner.recordPageResult({ elapsed: 0.5 });
      expect(decision).toBe('warmup');
      expect(tuner.getPageDelay()).toBe(initialDelay);
    });

    it('decreases delay on stable throughput (additive increase)', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordPageResult({ elapsed: 0.5 }); // warmup
      const decision = tuner.recordPageResult({ elapsed: 0.5 });
      expect(decision).toBe('increase');
      expect(tuner.getPageDelay()).toBe(450); // 500 - 50
    });

    it('increases delay on throughput drop (multiplicative decrease)', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 300 });
      tuner.recordPageResult({ elapsed: 0.1 }); // warmup with fast response
      const decision = tuner.recordPageResult({ elapsed: 2.0 }); // sudden slowdown
      expect(decision).toBe('decrease');
      expect(tuner.getPageDelay()).toBeGreaterThan(300);
    });

    it('skips EMA update when elapsed is 0', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      const decision = tuner.recordPageResult({ elapsed: 0 });
      expect(decision).toBe('skip');
      expect(tuner.getPageDelay()).toBe(500);
    });

    it('skips EMA update when elapsed is negative', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      const decision = tuner.recordPageResult({ elapsed: -1 });
      expect(decision).toBe('skip');
      expect(tuner.getPageDelay()).toBe(500);
    });

    it('never decreases delay below pageDelayMin', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 100 });
      tuner.recordPageResult({ elapsed: 0.1 });
      for (let i = 0; i < 20; i++) {
        tuner.recordPageResult({ elapsed: 0.1 });
      }
      expect(tuner.getPageDelay()).toBe(50);
    });

    it('never increases delay above pageDelayMax', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 9000 });
      tuner.recordPageResult({ elapsed: 0.1 }); // warmup fast
      tuner.recordPageResult({ elapsed: 100 }); // extreme slowdown
      expect(tuner.getPageDelay()).toBeLessThanOrEqual(10_000);
    });
  });

  describe('AIMD — media track', () => {
    it('returns warmup on first result and seeds EMA without changing concurrency', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      const initial = tuner.getMediaConcurrency();
      const decision = tuner.recordMediaResult({ elapsed: 1.0, bytesDownloaded: 1_000_000 });
      expect(decision).toBe('warmup');
      expect(tuner.getMediaConcurrency()).toBe(initial);
    });

    it('increases concurrency on stable throughput', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordMediaResult({ elapsed: 1.0, bytesDownloaded: 1_000_000 });
      const decision = tuner.recordMediaResult({ elapsed: 1.0, bytesDownloaded: 1_000_000 });
      expect(decision).toBe('increase');
      expect(tuner.getMediaConcurrency()).toBe(7);
    });

    it('decreases concurrency on throughput drop', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordMediaResult({ elapsed: 1.0, bytesDownloaded: 10_000_000 });
      const decision = tuner.recordMediaResult({ elapsed: 10.0, bytesDownloaded: 1_000_000 });
      expect(decision).toBe('decrease');
      expect(tuner.getMediaConcurrency()).toBeLessThan(6);
    });

    it('never drops concurrency below 1', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      for (let i = 0; i < 20; i++) {
        tuner.recordMediaError();
      }
      expect(tuner.getMediaConcurrency()).toBe(1);
    });

    it('never increases concurrency above max', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordMediaResult({ elapsed: 0.1, bytesDownloaded: 10_000_000 });
      for (let i = 0; i < 20; i++) {
        tuner.recordMediaResult({ elapsed: 0.1, bytesDownloaded: 10_000_000 });
      }
      expect(tuner.getMediaConcurrency()).toBe(12);
    });
  });

  describe('error backoff', () => {
    it('doubles page delay on error', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordPageError();
      expect(tuner.getPageDelay()).toBe(1000);
    });

    it('halves media concurrency on error', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordMediaError();
      expect(tuner.getMediaConcurrency()).toBe(3);
    });

    it('suppresses tuning for errorBackoffRequests calls after error', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordPageError(); // delay → 1000, backoff = 3
      const delayAfterError = tuner.getPageDelay();

      // Next 3 calls should be warmup then error_backoff — no value change
      for (let i = 0; i < 3; i++) {
        const decision = tuner.recordPageResult({ elapsed: 0.5 });
        expect(decision).toBe(i === 0 ? 'warmup' : 'error_backoff');
      }
      // 4th call should resume normal tuning
      const decision = tuner.recordPageResult({ elapsed: 0.5 });
      expect(decision).toBe('increase');
      expect(tuner.getPageDelay()).toBeLessThan(delayAfterError);
    });

    it('resets throughputEma on error (re-warmup)', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordPageResult({ elapsed: 0.5 });
      tuner.recordPageResult({ elapsed: 0.5 });
      tuner.recordPageError();
      const decision = tuner.recordPageResult({ elapsed: 0.5 });
      expect(decision).toBe('warmup');
    });
  });

  describe('track independence', () => {
    it('page errors do not affect media track', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      const mediaBefore = tuner.getMediaConcurrency();
      tuner.recordPageError();
      expect(tuner.getMediaConcurrency()).toBe(mediaBefore);
      expect(tuner.getPageDelay()).toBe(1000);
    });

    it('media errors do not affect page track', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      const pageBefore = tuner.getPageDelay();
      tuner.recordMediaError();
      expect(tuner.getPageDelay()).toBe(pageBefore);
      expect(tuner.getMediaConcurrency()).toBe(3);
    });
  });

  describe('state round-trip', () => {
    it('restores exact behavior from saved state', () => {
      const tuner1 = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner1.recordPageResult({ elapsed: 0.3 });
      tuner1.recordPageResult({ elapsed: 0.3 });
      tuner1.recordMediaResult({ elapsed: 1.0, bytesDownloaded: 2_000_000 });

      const state = tuner1.getState();
      const tuner2 = new AdaptiveTuner({ pageDelayStart: 500 }, state);

      expect(tuner2.getPageDelay()).toBe(tuner1.getPageDelay());
      expect(tuner2.getMediaConcurrency()).toBe(tuner1.getMediaConcurrency());

      const d1 = tuner1.recordPageResult({ elapsed: 0.3 });
      const d2 = tuner2.recordPageResult({ elapsed: 0.3 });
      expect(d2).toBe(d1);
      expect(tuner2.getPageDelay()).toBe(tuner1.getPageDelay());
    });
  });

  describe('oscillation damping', () => {
    it('consecutive delay changes are gradual, not extreme jumps', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordPageResult({ elapsed: 0.2 }); // warmup

      const delays: number[] = [tuner.getPageDelay()];
      for (let i = 0; i < 20; i++) {
        const elapsed = i % 2 === 0 ? 0.1 : 1.0;
        tuner.recordPageResult({ elapsed });
        delays.push(tuner.getPageDelay());
      }

      // Each step-to-step change should be bounded — not jumping from
      // min to max in a single step. The largest single-step change
      // should be much less than the full range.
      let maxStep = 0;
      for (let i = 1; i < delays.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(delays[i] - delays[i - 1]));
      }
      // Additive increase is 50ms. Multiplicative decrease is ~1.43x.
      // At pageDelayMax (10000), the largest decrease step would be
      // 10000 * (1/0.7 - 1) ≈ 4286. Verify steps are sub-5000.
      expect(maxStep).toBeLessThan(5000);
    });
  });

  describe('error recovery', () => {
    it('resumes normal increase after backoff expires', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      tuner.recordPageResult({ elapsed: 0.5 });
      tuner.recordPageError();
      const delayAfterError = tuner.getPageDelay();

      tuner.recordPageResult({ elapsed: 0.5 }); // warmup
      tuner.recordPageResult({ elapsed: 0.5 }); // error_backoff
      tuner.recordPageResult({ elapsed: 0.5 }); // error_backoff

      const decision = tuner.recordPageResult({ elapsed: 0.5 });
      expect(decision).toBe('increase');
      expect(tuner.getPageDelay()).toBeLessThan(delayAfterError);
    });
  });

  describe('getPageConcurrency', () => {
    it('returns 3 when delay is below 200ms', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 50 });
      expect(tuner.getPageConcurrency()).toBe(3);
    });

    it('returns 3 at delay 199ms', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 199 });
      expect(tuner.getPageConcurrency()).toBe(3);
    });

    it('returns 2 at delay 200ms', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 200 });
      expect(tuner.getPageConcurrency()).toBe(2);
    });

    it('returns 2 at delay 499ms', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 499 });
      expect(tuner.getPageConcurrency()).toBe(2);
    });

    it('returns 1 at delay 500ms', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 500 });
      expect(tuner.getPageConcurrency()).toBe(1);
    });

    it('returns 1 at high delay (error backoff)', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 5000 });
      expect(tuner.getPageConcurrency()).toBe(1);
    });

    it('decreases concurrency when tuner backs off', () => {
      const tuner = new AdaptiveTuner({ pageDelayStart: 100 });
      expect(tuner.getPageConcurrency()).toBe(3);
      tuner.recordPageError(); // 100 → 200
      expect(tuner.getPageConcurrency()).toBe(2);
      tuner.recordPageError(); // 200 → 400
      expect(tuner.getPageConcurrency()).toBe(2);
      tuner.recordPageError(); // 400 → 800
      expect(tuner.getPageConcurrency()).toBe(1);
    });
  });
});
