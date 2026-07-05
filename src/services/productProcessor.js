/**
 * Product Processor
 * 
 * Handles discovery of products without SKUs using Shopify's Bulk Operations API
 * and paginated queries as fallback. Processes JSONL results and filters variants.
 */

import { graphqlRequest, DRY_RUN } from '../config/shopify.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import { getAccessToken } from '../utils/tokenManager.js';
import logger, { logProgress } from '../utils/logger.js';
import progressTracker from '../utils/progressTracker.js';
import { generateSku } from './skuGenerator.js';


const BULK_QUERY = `
  mutation {
    bulkOperationRunQuery(
      query: """
      {
        products {
          edges {
            node {
              id
              title
              variants {
                edges {
                  node {
                    id
                    sku
                    inventoryItem {
                      id
                      unitCost {
                        amount
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      """
    ) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_STATUS_QUERY = `
  query GetBulkOperation($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  }
`;

export async function startBulkQuery() {
  logger.info('Starting bulk query operation');

  const accessToken = await getAccessToken();

  const result = await rateLimiter.executeWithRateLimit(
    () => graphqlRequest(BULK_QUERY, {}, accessToken),
    10,
    'startBulkQuery'
  );

  if (result.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
    const errors = result.data.bulkOperationRunQuery.userErrors;
    throw new Error(`Bulk query failed: ${JSON.stringify(errors)}`);
  }

  const operationId = result.data.bulkOperationRunQuery.bulkOperation.id;
  logger.info('Bulk query started', { operationId });

  return operationId;
}


export async function pollBulkOperation(operationId) {
  const maxWaitMs = 10 * 60 * 1000;
  const pollIntervalMs = 5000;
  const startTime = Date.now();

  logger.info('Polling bulk operation', { operationId });

  while (Date.now() - startTime < maxWaitMs) {
    const accessToken = await getAccessToken();

    const result = await rateLimiter.executeWithRateLimit(
      () => graphqlRequest(BULK_STATUS_QUERY, { id: operationId }, accessToken),
      1,
      `pollBulkOperation-${operationId}`
    );

    const operation = result.data?.node;
    if (!operation) {
      throw new Error('Bulk operation not found');
    }

    const status = operation.status;
    logger.debug('Bulk operation status', { 
      operationId, 
      status, 
      objectCount: operation.objectCount,
      elapsed: `${((Date.now() - startTime) / 1000).toFixed(0)}s`,
    });

    if (status === 'COMPLETED') {
      logger.info('Bulk operation completed', { 
        operationId, 
        objectCount: operation.objectCount,
        fileSize: operation.fileSize,
      });
      return operation.url;
    }

    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`Bulk operation ${status}: ${operation.errorCode || 'Unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Bulk operation polling timeout exceeded (10 minutes)');
}


export async function downloadBulkResults(url) {
  logger.info('Downloading bulk operation results');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download bulk results: HTTP ${response.status}`);
  }

  const text = await response.text();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  logger.info('Downloaded bulk results', { lineCount: lines.length });

  const products = [];
  const variants = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      const isProduct = Boolean(
        obj?.id &&
        (obj.__typename === 'Product' || (typeof obj.title === 'string' && !obj.__parentId && !obj.inventoryItem))
      );
      const isVariant = Boolean(
        obj?.id &&
        (obj.__typename === 'ProductVariant' || obj.__parentId || obj.inventoryItem || obj.sku !== undefined)
      );

      if (isProduct) {
        products.push({
          id: obj.id,
          title: obj.title,
          variants: [],
        });
      } else if (isVariant) {
        const unitCostValue = obj.inventoryItem?.unitCost?.amount;
        variants.push({
          id: obj.id,
          sku: obj.sku,
          productId: obj.__parentId,
          inventoryItemId: obj.inventoryItem?.id,
          unitCost: unitCostValue == null ? null : parseFloat(unitCostValue),
        });
      }
    } catch (err) {
      logger.warn('Failed to parse JSONL line', { error: err.message, line: line.substring(0, 200) });
    }
  }

  const productMap = new Map(products.map(p => [p.id, p]));
  for (const variant of variants) {
    const product = productMap.get(variant.productId);
    if (product) {
      product.variants.push(variant);
    }
  }

  const validProducts = products.filter(p => p.variants.length > 0);
  logger.info('Parsed bulk results', { 
    productCount: validProducts.length, 
    variantCount: variants.length,
  });

  return validProducts;
}


export function filterVariantsNeedingSku(products) {
  const needingSku = [];
  const skippedReasons = {
    hasSku: 0,
    noCost: 0,
    noInventoryItem: 0,
  };

  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.sku && variant.sku.trim() !== '') {
        skippedReasons.hasSku++;
        progressTracker.recordSkipped();
        continue;
      }

      if (!variant.unitCost || variant.unitCost === '0.00' || parseFloat(variant.unitCost) <= 0) {
        skippedReasons.noCost++;
        progressTracker.recordSkipped();
        continue;
      }

      if (!variant.inventoryItemId) {
        skippedReasons.noInventoryItem++;
        progressTracker.recordSkipped();
        continue;
      }

      needingSku.push({
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        inventoryItemId: variant.inventoryItemId,
        unitCost: parseFloat(variant.unitCost),
        existingSku: variant.sku,
      });
    }
  }

  logger.info('Filtered variants needing SKU', {
    needingSku: needingSku.length,
    skipped: {
      hasSku: skippedReasons.hasSku,
      noCost: skippedReasons.noCost,
      noInventoryItem: skippedReasons.noInventoryItem,
    },
  });

  return needingSku;
}


export function generateSkusForVariants(variants) {
  const usedSkus = new Set();
  const skuMap = new Map();

  for (const variant of variants) {
    const sku = generateSku(variant.unitCost, usedSkus);
    if (sku) {
      skuMap.set(variant.inventoryItemId, {
        sku,
        variantId: variant.variantId,
        productTitle: variant.productTitle,
        unitCost: variant.unitCost,
      });
      progressTracker.recordGenerated();
    }
  }

  logger.info('Generated SKUs', { 
    generated: skuMap.size, 
    uniqueBaseSkus: usedSkus.size,
  });

  return skuMap;
}


export async function discoverAndGenerateSkus() {
  progressTracker.startPhase('discovering');

  const operationId = await startBulkQuery();
  const downloadUrl = await pollBulkOperation(operationId);
  const products = await downloadBulkResults(downloadUrl);

  progressTracker.startPhase('generating', products.length);
  const needingSku = filterVariantsNeedingSku(products);
  const skuMap = generateSkusForVariants(needingSku);

  progressTracker.startPhase('updating', skuMap.size);

  return skuMap;
}


export async function discoverAndGenerateSkusPaginated(pageSize = 50) {
  logger.info('Using paginated discovery (fallback mode)');
  progressTracker.startPhase('discovering');

  const products = [];
  let hasNextPage = true;
  let cursor = null;

  const PAGINATED_QUERY = `
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                    unitCost {
                      amount
                    }
                  }
                }
              }
            }
          }
          cursor
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

  while (hasNextPage) {
    const accessToken = await getAccessToken();

    const result = await rateLimiter.executeWithRateLimit(
      () => graphqlRequest(PAGINATED_QUERY, { first: pageSize, after: cursor }, accessToken),
      50,
      `paginated-${cursor || 'start'}`
    );

    const edges = result.data?.products?.edges || [];
    const pageInfo = result.data?.products?.pageInfo;

    for (const edge of edges) {
      const product = edge.node;
      const variants = product.variants?.edges?.map(v => ({
        id: v.node.id,
        sku: v.node.sku,
        inventoryItemId: v.node.inventoryItem?.id,
        unitCost: v.node.inventoryItem?.unitCost?.amount,
      })) || [];

      products.push({
        id: product.id,
        title: product.title,
        variants,
      });
    }

    hasNextPage = pageInfo?.hasNextPage || false;
    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

    logProgress('Paginated fetch', products.length, products.length + (hasNextPage ? '+' : 0));
  }

  logger.info('Paginated discovery complete', { productCount: products.length });

  progressTracker.startPhase('generating', products.length);
  const needingSku = filterVariantsNeedingSku(products);
  const skuMap = generateSkusForVariants(needingSku);

  progressTracker.startPhase('updating', skuMap.size);

  return skuMap;
}


export default {
  discoverAndGenerateSkus,
  discoverAndGenerateSkusPaginated,
  filterVariantsNeedingSku,
  generateSkusForVariants,
};
