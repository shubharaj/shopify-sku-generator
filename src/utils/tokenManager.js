/**
 * Token Manager
 * 
 * Handles Shopify OAuth Client Credentials grant flow.
 * As of 2026, Shopify no longer provides static access tokens (shpat_xxx).
 * Instead, you exchange Client ID + Client Secret for a short-lived access token.
 * 
 * This module:
 * 1. Exchanges credentials for an access token via POST to /admin/oauth/access_token
 * 2. Caches the token with expiry tracking
 * 3. Auto-refreshes the token before it expires (every ~24 hours)
 * 
 * Token format: The access token returned is a standard OAuth token (not shpat_ format)
 * It expires in ~24 hours (86399 seconds)
 */

import { SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } from '../config/shopify.js';
import logger from './logger.js';

// Token cache
let cachedToken = null;
let tokenExpiresAt = null;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

/**
 * Exchange Client ID + Client Secret for an access token
 * Uses Shopify's OAuth Client Credentials grant
 * 
 * POST https://{shop}.myshopify.com/admin/oauth/access_token
 * Content-Type: application/x-www-form-urlencoded
 * Body: grant_type=client_credentials&client_id=xxx&client_secret=xxx
 */
export async function fetchAccessToken() {
  logger.info('Fetching new access token via Client Credentials grant');

  const url = `https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token request failed: HTTP ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error(`Invalid token response: ${JSON.stringify(data)}`);
  }

  // Calculate expiry time
  const expiresInMs = (data.expires_in || 86399) * 1000;
  tokenExpiresAt = Date.now() + expiresInMs;
  cachedToken = data.access_token;

  logger.info('Access token obtained successfully', {
    scope: data.scope,
    expiresIn: `${Math.round(expiresInMs / 1000 / 60)} minutes`,
    expiresAt: new Date(tokenExpiresAt).toISOString(),
  });

  return cachedToken;
}

/**
 * Get a valid access token, fetching a new one if needed
 * Checks cache and auto-refreshes if token is about to expire
 */
export async function getAccessToken() {
  // If we have a cached token that's still valid (with buffer), return it
  if (cachedToken && tokenExpiresAt && Date.now() < (tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS)) {
    logger.debug('Using cached access token');
    return cachedToken;
  }

  // Need to fetch a new token
  return await fetchAccessToken();
}

/**
 * Force refresh the token (useful if you get 401 errors)
 */
export async function refreshToken() {
  cachedToken = null;
  tokenExpiresAt = null;
  return await fetchAccessToken();
}

/**
 * Get token expiry info for monitoring
 */
export function getTokenStatus() {
  if (!cachedToken || !tokenExpiresAt) {
    return { status: 'no_token', expiresIn: null };
  }

  const expiresIn = tokenExpiresAt - Date.now();
  if (expiresIn <= 0) {
    return { status: 'expired', expiresIn: 0 };
  }

  const needsRefresh = expiresIn < TOKEN_REFRESH_BUFFER_MS;
  return {
    status: needsRefresh ? 'needs_refresh' : 'valid',
    expiresIn: Math.round(expiresIn / 1000), // seconds
    expiresAt: new Date(tokenExpiresAt).toISOString(),
  };
}

export default {
  fetchAccessToken,
  getAccessToken,
  refreshToken,
  getTokenStatus,
};
