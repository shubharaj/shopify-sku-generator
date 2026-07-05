/**
 * Shopify SKU Generator - Main Entry Point
 * 
 * Production-ready application that generates unique SKUs from Cost Per Item
 * and updates products in bulk using Shopify GraphQL Admin API 2026-04.
 * 
 * Authentication: Uses OAuth Client Credentials flow (2026+).
 * Client ID + Client Secret are exchanged for a short-lived access token.
 */

import { config } from 'dotenv';
config();

import logger from './utils/logger.js';
import { getAccessToken } from './utils/tokenManager.js';
import progressTracker from './utils/progressTracker.js';
import { discoverAndGenerateSkus, discoverAndGenerateSkusPaginated } from './services/productProcessor.js';
import { executeSkuUpdates } from './services/bulkUpdater.js';
import { DRY_RUN } from './config/shopify.js';

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    const stats = progressTracker.getStats();
    logger.info('Shutdown stats', stats);

    await progressTracker.saveState();

    // Allow logger to flush
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
}

/**
 * Main execution flow
 */
async function main() {
  const startTime = Date.now();

  logger.info('========================================');
  logger.info('Shopify SKU Generator Starting');
  logger.info(`API Version: 2026-04`);
  logger.info(`Dry Run: ${DRY_RUN}`);
  logger.info('========================================');

  try {
    // Step 0: Pre-fetch access token (validates credentials early)
    logger.info('Authenticating with Shopify...');
    await getAccessToken();
    logger.info('Authentication successful');

    // Load previous state if resuming
    await progressTracker.loadState();

    // Check if we can resume from previous run
    if (progressTracker.canResume()) {
      logger.info('Resuming from previous run', {
        lastProcessedId: progressTracker.state.lastProcessedId,
      });
    } else if (progressTracker.state.phase === 'completed') {
      logger.info('Previous run completed. Resetting for new run.');
      await progressTracker.reset();
    }

    // Phase 1: Discover products and generate SKUs
    let skuMap;
    try {
      skuMap = await discoverAndGenerateSkus();
    } catch (error) {
      logger.warn('Bulk query failed, falling back to paginated queries', { error: error.message });
      skuMap = await discoverAndGenerateSkusPaginated();
    }

    if (skuMap.size === 0) {
      logger.info('No products need SKU updates');
      await progressTracker.complete();
      return;
    }

    // Phase 2: Update all SKUs
    const results = await executeSkuUpdates(skuMap);

    // Final stats
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = progressTracker.getStats();

    logger.info('========================================');
    logger.info('SKU Generator Complete');
    logger.info(`Duration: ${duration}s`);
    logger.info(`Total products processed: ${stats.totalProducts}`);
    logger.info(`SKUs generated: ${stats.generatedSkus}`);
    logger.info(`Variants updated: ${stats.updatedVariants}`);
    logger.info(`Variants failed: ${stats.failedVariants}`);
    logger.info(`Variants skipped: ${stats.skippedVariants}`);
    logger.info('========================================');

  } catch (error) {
    logger.error('Fatal error in main execution', { 
      error: error.message, 
      stack: error.stack,
    });
    await progressTracker.fail(error);
    process.exit(1);
  }
}

// Setup handlers
setupGracefulShutdown();

// Run
main().catch(async (error) => {
  logger.error('Unhandled error', { error: error.message });
  await progressTracker.fail(error);
  process.exit(1);
});
