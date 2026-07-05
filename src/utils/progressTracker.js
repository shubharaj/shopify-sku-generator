/**
 * Progress Tracker
 * 
 * Tracks long-running operation progress and supports resume capability.
 * Saves state to disk for crash recovery.
 */

import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';

const STATE_FILE = '.progress.json';

class ProgressTracker {
  constructor() {
    this.state = {
      phase: 'idle', // idle | discovering | generating | updating | completed | failed
      totalProducts: 0,
      processedProducts: 0,
      generatedSkus: 0,
      updatedVariants: 0,
      failedVariants: 0,
      skippedVariants: 0,
      lastProcessedId: null,
      startTime: null,
      endTime: null,
      errors: [],
    };
  }

  /**
   * Load previous state from disk
   */
  async loadState() {
    try {
      const data = await fs.readFile(STATE_FILE, 'utf-8');
      this.state = { ...this.state, ...JSON.parse(data) };
      logger.info('Loaded previous progress state', { 
        phase: this.state.phase,
        processed: this.state.processedProducts,
        total: this.state.totalProducts,
      });
    } catch (err) {
      // No previous state - start fresh
      logger.info('No previous state found, starting fresh');
    }
  }

  /**
   * Save current state to disk
   */
  async saveState() {
    try {
      await fs.writeFile(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error('Failed to save progress state', { error: err.message });
    }
  }

  /**
   * Start a new phase
   */
  startPhase(phase, total = 0) {
    this.state.phase = phase;
    this.state.totalProducts = total;
    if (phase === 'discovering') {
      this.state.startTime = Date.now();
    }
    this.saveState();
    logger.info(`Starting phase: ${phase}`, { total });
  }

  /**
   * Update progress counters
   */
  updateProgress(increment = 1, lastId = null) {
    this.state.processedProducts += increment;
    if (lastId) this.state.lastProcessedId = lastId;

    // Save every 100 items to avoid excessive I/O
    if (this.state.processedProducts % 100 === 0) {
      this.saveState();
    }
  }

  /**
   * Record a generated SKU
   */
  recordGenerated() {
    this.state.generatedSkus++;
  }

  /**
   * Record a successful update
   */
  recordUpdated(count = 1) {
    this.state.updatedVariants += count;
  }

  /**
   * Record a failed update
   */
  recordFailed(error) {
    this.state.failedVariants++;
    this.state.errors.push({
      timestamp: new Date().toISOString(),
      message: error.message || error,
    });

    // Keep only last 100 errors
    if (this.state.errors.length > 100) {
      this.state.errors = this.state.errors.slice(-100);
    }
  }

  /**
   * Record a skipped variant (already has SKU or no cost)
   */
  recordSkipped() {
    this.state.skippedVariants++;
  }

  /**
   * Mark operation as completed
   */
  async complete() {
    this.state.phase = 'completed';
    this.state.endTime = Date.now();
    await this.saveState();

    const duration = (this.state.endTime - this.state.startTime) / 1000;
    logger.info('Operation completed', {
      duration: `${duration.toFixed(1)}s`,
      totalProducts: this.state.totalProducts,
      generatedSkus: this.state.generatedSkus,
      updatedVariants: this.state.updatedVariants,
      failedVariants: this.state.failedVariants,
      skippedVariants: this.state.skippedVariants,
    });
  }

  /**
   * Mark operation as failed
   */
  async fail(error) {
    this.state.phase = 'failed';
    this.state.endTime = Date.now();
    this.state.errors.push({
      timestamp: new Date().toISOString(),
      message: error.message || error,
    });
    await this.saveState();
    logger.error('Operation failed', { error: error.message });
  }

  /**
   * Get current statistics
   */
  getStats() {
    const duration = this.state.startTime 
      ? ((this.state.endTime || Date.now()) - this.state.startTime) / 1000 
      : 0;

    return {
      ...this.state,
      duration: `${duration.toFixed(1)}s`,
      progress: this.state.totalProducts > 0 
        ? ((this.state.processedProducts / this.state.totalProducts) * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  /**
   * Check if we can resume from a previous run
   */
  canResume() {
    return this.state.phase === 'updating' && this.state.lastProcessedId !== null;
  }

  /**
   * Reset state for a fresh run
   */
  async reset() {
    this.state = {
      phase: 'idle',
      totalProducts: 0,
      processedProducts: 0,
      generatedSkus: 0,
      updatedVariants: 0,
      failedVariants: 0,
      skippedVariants: 0,
      lastProcessedId: null,
      startTime: null,
      endTime: null,
      errors: [],
    };
    await this.saveState();
  }
}

export const progressTracker = new ProgressTracker();
export default progressTracker;
