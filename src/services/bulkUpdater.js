/**
 * Bulk Updater
 * 
 * Handles batched SKU updates to Shopify using inventoryItemUpdate mutation.
 * Implements rate-limited batch processing with progress tracking.
 */

import { graphqlRequest, BATCH_SIZE, DRY_RUN } from '../config/shopify.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import { getAccessToken } from '../utils/tokenManager.js';
import logger, { logProgress } from '../utils/logger.js';
import progressTracker from '../utils/progressTracker.js';

// CORRECTED: Use inventoryItemUpdate to update SKU (SKU lives on InventoryItem, not ProductVariant)
const UPDATE_SKU_MUTATION = `
  mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        sku
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Update a single inventory item's SKU
 * @param {string} inventoryItemId - Inventory item ID (GID)
 * @param {string} sku - New SKU
 * @returns {Promise<object>} - Update result
 */
export async function updateInventoryItemSku(inventoryItemId, sku) {
  if (DRY_RUN) {
    logger.debug('DRY RUN: Would update SKU', { inventoryItemId, sku });
    return { success: true, dryRun: true };
  }

  const accessToken = await getAccessToken();

  const result = await rateLimiter.executeWithRateLimit(
    () => graphqlRequest(UPDATE_SKU_MUTATION, {
      id: inventoryItemId,
      input: { sku }
    }, accessToken),
    10, // Mutation costs 10 points
    `update-${inventoryItemId}`
  );

  const updateResult = result.data?.inventoryItemUpdate;

  if (!updateResult) {
    const graphQLErrors = result.errors ? JSON.stringify(result.errors) : 'unknown';
    logger.error('Mutation returned no data', { inventoryItemId, graphQLErrors });
    throw new Error(`Mutation failed: no data returned. Errors: ${graphQLErrors}`);
  }

  if (updateResult?.userErrors?.length > 0) {
    const errors = updateResult.userErrors;
    logger.error('Failed to update SKU', { inventoryItemId, sku, errors });
    throw new Error(`Update failed: ${JSON.stringify(errors)}`);
  }

  return {
    success: true,
    inventoryItemId,
    sku,
    updatedItem: updateResult?.inventoryItem,
  };
}

/**
 * Process a batch of SKU updates
 * @param {Array<{inventoryItemId: string, sku: string}>} batch - Items to update
 * @returns {Promise<{success: number, failed: number, errors: Array}>} - Results
 */
export async function processBatch(batch) {
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  logger.info('Processing batch', { batchSize: batch.length });

  for (const item of batch) {
    try {
      await updateInventoryItemSku(item.inventoryItemId, item.sku);
      results.success++;
      progressTracker.recordUpdated();
    } catch (error) {
      results.failed++;
      results.errors.push({
        inventoryItemId: item.inventoryItemId,
        sku: item.sku,
        error: error.message,
      });
      logger.error('SKU update failed for inventory item', { 
        inventoryItemId: item.inventoryItemId, 
        sku: item.sku, 
        error: error.message,
      });
      progressTracker.recordFailed(error);
    }
  }

  logger.info('Batch complete', { 
    success: results.success, 
    failed: results.failed,
  });

  return results;
}

/**
 * Update all SKUs in batches with progress tracking
 * @param {Map<string, object>} skuMap - Map of inventoryItemId to SKU data
 * @returns {Promise<{total: number, success: number, failed: number}>} - Final results
 */
export async function updateAllSkus(skuMap) {
  const items = Array.from(skuMap.entries()).map(([inventoryItemId, data]) => ({
    inventoryItemId,
    sku: data.sku,
    variantId: data.variantId,
    productTitle: data.productTitle,
    unitCost: data.unitCost,
  }));

  const total = items.length;
  let processed = 0;
  let success = 0;
  let failed = 0;

  logger.info('Starting SKU updates', { totalItems: total, batchSize: BATCH_SIZE });

  // Process in batches
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const batchResults = await processBatch(batch);

    success += batchResults.success;
    failed += batchResults.failed;
    processed += batch.length;

    // Log progress periodically
    if (processed % (BATCH_SIZE * 10) === 0 || processed === total) {
      logProgress('SKU Update', processed, total, {
        success,
        failed,
        percentage: ((processed / total) * 100).toFixed(1) + '%',
      });
    }

    // Save progress every batch
    await progressTracker.updateProgress(batch.length);
  }

  logger.info('All SKU updates complete', { total, success, failed });

  return { total, success, failed };
}

/**
 * Main update flow: takes SKU map and updates all items
 * @param {Map} skuMap - Generated SKU mappings
 * @returns {Promise<object>} - Update statistics
 */
export async function executeSkuUpdates(skuMap) {
  if (skuMap.size === 0) {
    logger.info('No SKUs to update');
    return { total: 0, success: 0, failed: 0 };
  }

  progressTracker.startPhase('updating', skuMap.size);

  const results = await updateAllSkus(skuMap);

  if (results.failed === 0) {
    await progressTracker.complete();
  } else {
    logger.warn('Some updates failed', { failed: results.failed });
  }

  return results;
}

export default {
  updateInventoryItemSku,
  processBatch,
  updateAllSkus,
  executeSkuUpdates,
};