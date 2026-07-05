/**
 * Cost-Aware Rate Limiter
 * 
 * Implements Shopify GraphQL Admin API rate limit handling.
 * Uses token bucket algorithm with deterministic backoff based on restoreRate.
 * 
 * Shopify rate limits (2026):
 * - Standard: 1,000 max points, 50 points/second restore
 * - Plus: 2,000 max points, 100 points/second restore
 * - Mutations: 10 points each
 * - Bulk operations: 10 points to start, free execution
 */

import { MAX_RETRIES, RETRY_DELAY_BASE } from '../config/shopify.js';
import logger, { logRateLimit } from './logger.js';

class RateLimiter {
  constructor() {
    this.maxAvailable = 1000; // Will be updated from first response
    this.currentlyAvailable = 1000;
    this.restoreRate = 50; // points per second
    this.lastUpdateTime = Date.now();
    this.retryCount = new Map(); // Track retries per operation
  }

  /**
   * Update internal state from Shopify response
   * @param {object} throttleStatus - extensions.cost.throttleStatus
   */
  updateFromResponse(throttleStatus) {
    if (!throttleStatus) return;

    this.maxAvailable = throttleStatus.maximumAvailable;
    this.currentlyAvailable = throttleStatus.currentlyAvailable;
    this.restoreRate = throttleStatus.restoreRate;
    this.lastUpdateTime = Date.now();

    logRateLimit(throttleStatus);
  }

  /**
   * Calculate current available points (accounting for time passed)
   * @returns {number} - Estimated currently available points
   */
  getEstimatedAvailable() {
    const elapsedSeconds = (Date.now() - this.lastUpdateTime) / 1000;
    const restored = elapsedSeconds * this.restoreRate;
    return Math.min(
      this.currentlyAvailable + restored,
      this.maxAvailable
    );
  }

  /**
   * Check if we can execute a query with given cost
   * @param {number} requestedCost - Estimated cost of the query
   * @returns {boolean}
   */
  canExecute(requestedCost) {
    return this.getEstimatedAvailable() >= requestedCost;
  }

  /**
   * Calculate wait time needed before executing a query
   * @param {number} requestedCost - Cost of the query we want to run
   * @returns {number} - Wait time in milliseconds
   */
  calculateWaitTime(requestedCostOrThrottleStatus, requestedCost = null) {
    const throttleStatus = requestedCost === null ? null : requestedCostOrThrottleStatus;
    const requestedCostValue = requestedCost === null ? requestedCostOrThrottleStatus : requestedCost;
    const available = throttleStatus
      ? throttleStatus.currentlyAvailable
      : this.getEstimatedAvailable();
    const restoreRate = throttleStatus
      ? throttleStatus.restoreRate
      : this.restoreRate;

    if (available >= requestedCostValue) return 0;

    const deficit = requestedCostValue - available;
    // Add 10% buffer + 500ms safety margin
    const waitMs = Math.ceil((deficit * 1.1) / restoreRate * 1000) + 500;
    return Math.max(waitMs, 1000); // Minimum 1 second
  }

  /**
   * Wait for the calculated time
   * @param {number} ms - Milliseconds to wait
   */
  async sleep(ms) {
    if (ms <= 0) return;
    logger.debug(`Rate limit: waiting ${ms}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a function with automatic rate limit handling and retries
   * @param {function} fn - Async function to execute (receives accessToken as arg)
   * @param {number} estimatedCost - Estimated query cost
   * @param {string} operationId - Unique identifier for this operation
   * @returns {Promise<any>} - Result of fn
   */
  async executeWithRateLimit(fn, estimatedCost = 10, operationId = 'default') {
    const retries = this.retryCount.get(operationId) || 0;

    if (retries >= MAX_RETRIES) {
      throw new Error(`Max retries (${MAX_RETRIES}) exceeded for operation ${operationId}`);
    }

    // Wait if we don't have enough points
    const waitTime = this.calculateWaitTime(estimatedCost);
    if (waitTime > 0) {
      await this.sleep(waitTime);
    }

    try {
      const result = await fn();

      // Update state from response if available
      if (result?.extensions?.cost?.throttleStatus) {
        this.updateFromResponse(result.extensions.cost.throttleStatus);
      }

      // Reset retry count on success
      this.retryCount.set(operationId, 0);

      return result;
    } catch (error) {
      if (error.code === 'THROTTLED' && error.extensions?.cost?.throttleStatus) {
        this.updateFromResponse(error.extensions.cost.throttleStatus);

        const retryWait = this.calculateWaitTime(estimatedCost) + (retries * RETRY_DELAY_BASE);
        logger.warn(`Throttled. Retry ${retries + 1}/${MAX_RETRIES}. Waiting ${retryWait}ms`, {
          operationId,
          requestedCost: error.extensions?.cost?.requestedQueryCost,
        });

        this.retryCount.set(operationId, retries + 1);
        await this.sleep(retryWait);

        // Retry recursively
        return this.executeWithRateLimit(fn, estimatedCost, operationId);
      }

      // Non-throttle error - don't retry
      throw error;
    }
  }

  /**
   * Reset all retry counters
   */
  resetRetries() {
    this.retryCount.clear();
  }
}

export const rateLimiter = new RateLimiter();
export default rateLimiter;
