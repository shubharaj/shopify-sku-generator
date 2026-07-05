/**
 * Shopify API Configuration
 * 
 * Handles connection settings, API version, and HTTP client configuration
 * for Shopify GraphQL Admin API 2026-04.
 * 
 * As of 2026, Shopify uses OAuth Client Credentials flow:
 * - You provide Client ID + Client Secret (from Dev Dashboard)
 * - These are exchanged for a short-lived access token (~24h)
 * - The token manager handles this exchange and auto-refresh
 */

import { config } from 'dotenv';
config();

const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.API_VERSION || '2026-04';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 100;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10) || 5;
const RETRY_DELAY_BASE = parseInt(process.env.RETRY_DELAY_BASE, 10) || 1000;
const DRY_RUN = process.env.DRY_RUN === 'true';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const PROGRESS_INTERVAL = parseInt(process.env.PROGRESS_INTERVAL, 10) || 30;

// Validation
if (!SHOPIFY_SHOP_DOMAIN) {
  throw new Error('SHOPIFY_SHOP_DOMAIN is required. Set it in .env file.');
}
if (!SHOPIFY_CLIENT_ID) {
  throw new Error('SHOPIFY_CLIENT_ID is required. Get it from your Shopify Dev Dashboard -> Apps -> Your App -> Settings.');
}
if (!SHOPIFY_CLIENT_SECRET) {
  throw new Error('SHOPIFY_CLIENT_SECRET is required. Get it from your Shopify Dev Dashboard -> Apps -> Your App -> Settings.');
}

const GRAPHQL_ENDPOINT = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

/**
 * Make a GraphQL request to Shopify Admin API
 * @param {string} query - GraphQL query/mutation string
 * @param {object} variables - Variables for the query
 * @param {string} accessToken - OAuth access token (from token manager)
 * @returns {Promise<object>} - Parsed JSON response
 */
export async function graphqlRequest(query, variables = {}, accessToken) {
  if (!accessToken) {
    throw new Error('Access token is required. Call getAccessToken() from tokenManager first.');
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
      'Shopify-GraphQL-Cost-Debug': LOG_LEVEL === 'debug' ? '1' : '0',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();

  // ADD THIS DEBUG LOG:
  if (LOG_LEVEL === 'debug') {
    logger.debug('GraphQL response received', {
      hasErrors: !!(data.errors && data.errors.length > 0),
      hasData: !!data.data,
      errorCount: data.errors?.length || 0,
    });
  }


  // Check for GraphQL errors
  if (data.errors && data.errors.length > 0) {
    const throttled = data.errors.some(e => e.message === 'Throttled');
    if (throttled) {
      const error = new Error('Throttled');
      error.code = 'THROTTLED';
      error.extensions = data.extensions;
      throw error;
    }

    // Check for user errors in mutations
    if (data.data) {
      // Non-fatal GraphQL errors - return data for processing
      return data;
    }

    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

/**
 * Extract rate limit info from GraphQL response
 * @param {object} response - GraphQL response object
 * @returns {object|null} - Throttle status or null
 */
export function extractThrottleStatus(response) {
  if (response?.extensions?.cost?.throttleStatus) {
    return response.extensions.cost.throttleStatus;
  }
  return null;
}

/**
 * Calculate wait time in ms when throttled
 * @param {object} throttleStatus - Throttle status from response
 * @param {number} requestedCost - Cost of the failed query
 * @returns {number} - Wait time in milliseconds
 */
export function calculateWaitTime(throttleStatus, requestedCost) {
  const { maximumAvailable, currentlyAvailable, restoreRate } = throttleStatus;
  const deficit = requestedCost - currentlyAvailable;
  if (deficit <= 0) return 0;

  // Add 10% buffer to ensure we have enough points
  const waitMs = Math.ceil((deficit * 1.1) / restoreRate * 1000);
  return Math.max(waitMs, 1000); // Minimum 1 second
}

export {
  SHOPIFY_SHOP_DOMAIN,
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  API_VERSION,
  BATCH_SIZE,
  MAX_RETRIES,
  RETRY_DELAY_BASE,
  DRY_RUN,
  LOG_LEVEL,
  PROGRESS_INTERVAL,
  GRAPHQL_ENDPOINT,
};
