import { describe, it, expect, afterEach } from 'vitest';
import { faultpoint, armFault, disarmFault, withFault, clearFaults, FaultInjected } from './faultpoint.js';

afterEach(() => clearFaults());

describe('faultpoint', () => {
  it('is a no-op when nothing is armed', () => {
    expect(() => faultpoint('x:y')).not.toThrow();
  });

  it('throws FaultInjected for an armed name, then only that name', () => {
    armFault('a:b');
    expect(() => faultpoint('a:b')).toThrow(FaultInjected);
    expect(() => faultpoint('c:d')).not.toThrow();
  });

  it('stops throwing once disarmed', () => {
    armFault('a:b');
    disarmFault('a:b');
    expect(() => faultpoint('a:b')).not.toThrow();
  });

  it('withFault arms for the callback and disarms in finally even on throw', () => {
    expect(() =>
      withFault('a:b', () => {
        faultpoint('a:b');
      }),
    ).toThrow(FaultInjected);
    // disarmed afterwards
    expect(() => faultpoint('a:b')).not.toThrow();
  });
});
