/**
 * Unit Tests for Rate Limiter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { rateLimiter } from '../src/utils/rateLimiter.js';

describe('Rate Limiter', () => {
  it('should calculate wait time correctly', () => {
    const throttleStatus = {
      maximumAvailable: 1000,
      currentlyAvailable: 100,
      restoreRate: 50,
    };

    const waitTime = rateLimiter.calculateWaitTime(throttleStatus, 200);
    assert.ok(waitTime > 0);
    // Need 100 more points at 50/sec = 2 seconds, plus 10% buffer + 500ms
    assert.ok(waitTime >= 2500);
  });

  it('should return 0 wait time when sufficient points available', () => {
    const throttleStatus = {
      maximumAvailable: 1000,
      currentlyAvailable: 900,
      restoreRate: 50,
    };

    const waitTime = rateLimiter.calculateWaitTime(throttleStatus, 100);
    assert.strictEqual(waitTime, 0);
  });

  it('should update state from response', () => {
    const throttleStatus = {
      maximumAvailable: 2000,
      currentlyAvailable: 1500,
      restoreRate: 100,
    };

    rateLimiter.updateFromResponse(throttleStatus);

    assert.strictEqual(rateLimiter.maxAvailable, 2000);
    assert.strictEqual(rateLimiter.currentlyAvailable, 1500);
    assert.strictEqual(rateLimiter.restoreRate, 100);
  });
});
