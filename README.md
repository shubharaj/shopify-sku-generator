# Shopify SKU Generator App

A production-ready custom Shopify app that automatically generates unique SKUs for products based on their **Cost Per Item** (unit cost). Built for internal use.

## Overview

This app processes your Shopify product catalog and generates SKUs for products that don't already have one. The SKU is derived from the product's Cost Per Item using a deterministic algorithm.

### SKU Generation Algorithm

1. **Read Cost Per Item** → e.g., `450`
2. **Add 22%** → `450 * 1.22 = 549`
3. **Reverse digits** → `945`
4. **Convert digits at even positions (0, 2, 4...) to alphabets** using mapping:
   - `1 → A`, `2 → B`, `3 → C`, `4 → D`, `5 → E`, `6 → F`, `7 → G`, `8 → H`, `9 → I`, `0 → 0`
5. **Result** → `I4E`

#### Examples (with +22%)

| Cost Price | +22% | Reversed | SKU Base |
|-----------|------|----------|----------|
| 450 | 549 | `945` | `I4E` |
| 1200 | 1464 | `4641` | `D6D1` |
| 900 | 1098 | `8901` | `H901` |
| 800 | 976 | `679` | `F7I` |

### Uniqueness Guarantee

If multiple products share the same cost price (and thus the same base SKU), a sequential suffix is appended:

- `I4E-01`
- `I4E-02`
- `I4E-03`

## Architecture

```
shopify-sku-generator/
├── src/
│   ├── config/
│   │   └── shopify.js          # Shopify API client configuration
│   ├── services/
│   │   ├── skuGenerator.js     # SKU generation algorithm (reusable utility)
│   │   ├── productProcessor.js # Product fetching & filtering logic
│   │   └── bulkUpdater.js      # Bulk mutation execution with rate limiting
│   ├── utils/
│   │   ├── tokenManager.js     # OAuth Client Credentials token exchange
│   │   ├── rateLimiter.js      # Cost-aware GraphQL rate limit handler
│   │   ├── logger.js           # Structured logging
│   │   ├── progressTracker.js  # Progress tracking for long operations
│   │   └── diagnostic.js       # Runtime API diagnostic tool
│   └── index.js                # Main entry point
├── tests/
│   ├── skuGenerator.test.js    # Unit tests for SKU generation
│   ├── bulkUpdater.test.js     # Unit tests for bulk updater
│   ├── productProcessor.test.js # Unit tests for product processor
│   └── rateLimiter.test.js     # Unit tests for rate limiting
├── package.json
├── .env.example
└── README.md
```

## Technology Stack

- **Node.js 20+** (LTS)
- **Shopify GraphQL Admin API 2026-07**
- **OAuth Client Credentials** authentication (2026+ model)
- **Built-in rate limiting** (cost-aware, no external queue required)
- **Bulk Operations API** for 1M+ product processing
- **Winston** for structured logging

## Prerequisites

- Node.js 20+ installed
- Shopify store with Admin API access
- **Shopify Partners account** (to create an app and get Client ID/Secret)
- App configured with `read_products` and `write_inventory` scopes

## Authentication (2026+ Model)

As of 2026, Shopify no longer provides static access tokens (`shpat_xxx`). Instead, you use **OAuth Client Credentials flow**:

1. You provide **Client ID** (`shpss_xxx`) + **Client Secret**
2. The app exchanges these for a short-lived access token (~24h)
3. The token manager handles this automatically and auto-refreshes

### How to Get Client ID & Client Secret

1. Go to **partners.shopify.com**
2. **Apps** → **Create app** → **Create app manually**
3. Configure distribution: **Custom** (for your own store)
4. Set **App URL**: `https://shopify.dev/apps/default-app-home`
5. Add **Allowed redirect URLs**: `http://localhost:3000/auth/callback`
6. Under **API access** → **Configure** → Select scopes:
   - ✅ `read_products`
   - ✅ `write_inventory`
7. **Save** → Go to **Settings** tab
8. Copy:
   - **Client ID** (starts with `shpss_`)
   - **Client Secret** (long string, click "Reveal")

> ⚠️ **Important**: Client Credentials only works for stores you own. For client stores, use Authorization Code Grant instead.

## Installation

```bash
# Extract the archive
cd shopify-sku-generator

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

## Configuration

Edit `.env`:

```env
# REQUIRED: Your Shopify store domain (e.g., your-store.myshopify.com)
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com

# REQUIRED: Client ID from Shopify Dev Dashboard (starts with shpss_)
SHOPIFY_CLIENT_ID=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# REQUIRED: Client Secret from Shopify Dev Dashboard
SHOPIFY_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# API Version (default: 2026-07)
API_VERSION=2026-07

# Batch size for mutation batches (1-250, default: 100)
BATCH_SIZE=100

# Logging level: debug | info | warn | error (default: info)
LOG_LEVEL=info

# Dry run mode: true = log only, no actual API mutations (default: false)
DRY_RUN=false
```

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOPIFY_SHOP_DOMAIN` | Your `.myshopify.com` domain | Yes |
| `SHOPIFY_CLIENT_ID` | Client ID from Dev Dashboard (`shpss_...`) | Yes |
| `SHOPIFY_CLIENT_SECRET` | Client Secret from Dev Dashboard | Yes |
| `API_VERSION` | GraphQL API version (default: `2026-07`) | No |
| `BATCH_SIZE` | Mutation batch size (default: 100, max 250) | No |
| `LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, `error` | No |
| `DRY_RUN` | If `true`, only logs what would be updated without making changes | No |

## Usage

### Basic Run

```bash
npm start
```

This will:
1. Authenticate with Shopify using Client Credentials
2. Fetch all products without SKUs using **Bulk Operations API**
3. Generate unique SKUs from Cost Per Item (+22%)
4. Update products in batches with **automatic rate limiting**
5. Log progress and results

### Dry Run (Preview)

```bash
DRY_RUN=true npm start
```

Shows what would be updated without making any API mutations.

### With Custom Batch Size

```bash
BATCH_SIZE=50 npm start
```

Lower batch sizes reduce rate limit pressure but increase total API calls.

### Diagnostic Tool

If you're experiencing API issues, run the diagnostic tool:

```bash
node src/utils/diagnostic.js
```

This tests:
- API connectivity
- Token validity and scopes
- Mutation permissions with a live product

## How It Works

### 1. Authentication (Token Manager)

The app exchanges your Client ID + Client Secret for an access token:

```
POST https://your-store.myshopify.com/admin/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id=shpss_xxx
client_secret=xxx
```

The token is cached and auto-refreshed before expiry (~24 hours).

### 2. Discovery Phase (Bulk Query)

The app uses Shopify's **Bulk Operations API** to efficiently fetch all products and their variants without SKUs. This is the only scalable way to handle 1M+ products.

### 3. SKU Generation

For each variant without a SKU:

```javascript
const baseSku = generateSkuFromCost(450.00);  // "I4E"
const uniqueSku = ensureUnique(baseSku, usedSkus);  // "I4E-01"
```

### 4. Update Phase (Batched Mutations)

Updates are sent in batches using `inventoryItemUpdate` mutations, with automatic rate limit handling. SKU is stored on the `InventoryItem` object in Shopify's data model.

### Rate Limiting Strategy

The app implements **cost-aware rate limiting**:

- Parses `extensions.cost.throttleStatus` from every response
- Calculates wait time based on `restoreRate` when throttled
- Maintains a local token bucket tracker
- Automatically retries with deterministic backoff

This prevents 429 errors and ensures maximum throughput without hitting Shopify's limits.

## API Version

This app uses **Shopify GraphQL Admin API 2026-07**, which includes:

- `bulkOperationRunQuery` / `bulkOperationRunMutation` for async bulk operations
- `inventoryItemUpdate` mutation for SKU updates
- `productVariantsBulkUpdate` for variant-level updates
- Up to **5 concurrent bulk operations** per shop (2026-01+)
- Improved rate limit buckets for standard plans

## Performance

| Catalog Size | Estimated Time | API Calls |
|-------------|----------------|-----------|
| 10,000 products | ~2 minutes | ~100 |
| 100,000 products | ~15 minutes | ~1,000 |
| 1,000,000 products | ~2-3 hours | ~10,000 |

*Times are approximate and depend on store plan (rate limits) and network conditions.*

## Safety Features

- **Dry Run Mode**: Preview all changes before execution
- **Idempotent Updates**: Same input produces same output — safe to re-run
- **SKU Preservation**: Products with existing SKUs are never modified
- **Partial Failure Handling**: Individual mutation failures don't stop the batch
- **Progress Persistence**: Resume capability (logs last processed batch)
- **Graceful Shutdown**: SIGINT/SIGTERM handling to finish current batch before exiting

## Logging

Structured JSON logs are written to:
- **Console** (human-readable in development)
- **File** (`logs/sku-generator-YYYY-MM-DD.log`)

Log levels:
- `debug`: Verbose API request/response logging
- `info`: Standard progress updates
- `warn`: Rate limit warnings, retry notifications
- `error`: Failed mutations, critical errors

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage
```

## Troubleshooting

### "[API] Invalid API key or access token" (401)

This means the token exchange failed. Check:

1. Your `SHOPIFY_CLIENT_ID` starts with `shpss_` (NOT `shpat_`)
2. Your `SHOPIFY_CLIENT_SECRET` is correct (no extra spaces)
3. Your app is installed on the store (go to store admin → Apps → check if listed)
4. The store is owned by the same Partners account that created the app

### "shop_not_permitted" Error

Client Credentials only works for stores you own. For client stores, you must use **Authorization Code Grant** (full OAuth flow with browser redirect).

### "Throttled" Errors

The app should handle throttling automatically. If you see persistent throttling:

1. Reduce `BATCH_SIZE` in `.env` (try 50 or 25)
2. Check if other apps are consuming API quota
3. Consider upgrading to Shopify Plus for higher rate limits (2,000 points vs 1,000)

### Bulk Operation Timeouts

For very large catalogs (>500K products):

1. The app automatically uses `synchronous: false` for bulk operations
2. Polls for completion with exponential backoff
3. JSONL results are streamed, not loaded into memory

### Missing Cost Per Item

Products without a Cost Per Item are logged and skipped. You can:

1. Set costs in Shopify Admin first
2. Or modify `skuGenerator.js` to handle missing costs (e.g., generate from product ID)

### All Updates Failing

If all SKU updates fail with 0 success:

1. Run `node src/utils/diagnostic.js` to test API connectivity and mutation permissions
2. Check that your token has `write_inventory` scope in the logs
3. Verify you're using API version `2026-07` or later (older versions may have deprecated mutations)

## Development

```bash
# Run in development mode with debug logging
LOG_LEVEL=debug npm run dev

# Lint code
npm run lint

# Format code
npm run format
```

## Deployment

### Option 1: Local Machine / Server

```bash
# Use PM2 for process management
npm install -g pm2
pm2 start src/index.js --name sku-generator
```

### Option 2: Docker

```bash
# Build image
docker build -t shopify-sku-generator .

# Run container
docker run -d --env-file .env --name sku-gen shopify-sku-generator
```

### Option 3: Scheduled Job (Cron)

```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/app && /usr/bin/node src/index.js >> /var/log/sku-generator.log 2>&1
```

## Security Notes

- **Never commit `.env` files** — they contain sensitive credentials
- Store `SHOPIFY_CLIENT_SECRET` in a secrets manager in production
- The app uses **Client Credentials** (not OAuth user flow) — suitable for internal/private apps
- Rotate credentials regularly via Shopify Partners dashboard

## License

Internal use only. Not for redistribution.

## Support

For issues or questions:
1. Check the logs in `logs/` directory
2. Enable `DRY_RUN=true` to test without side effects
3. Run `node src/utils/diagnostic.js` for API diagnostics
4. Review Shopify API status at https://status.shopify.com
