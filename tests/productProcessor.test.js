import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { downloadBulkResults } from '../src/services/productProcessor.js';

describe('downloadBulkResults', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = async () => ({
      ok: true,
      text: async () => [
        '{"id":"gid://shopify/Product/1","title":"Test Product"}',
        '{"id":"gid://shopify/ProductVariant/1","__parentId":"gid://shopify/Product/1","sku":"","inventoryItem":{"id":"gid://shopify/InventoryItem/1","unitCost":{"amount":"450.00"}}}',
      ].join('\n'),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses newline-delimited JSONL bulk results into products and variants', async () => {
    const products = await downloadBulkResults('https://example.test/bulk.jsonl');

    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].title, 'Test Product');
    assert.strictEqual(products[0].variants.length, 1);
    assert.strictEqual(products[0].variants[0].inventoryItemId, 'gid://shopify/InventoryItem/1');
    assert.strictEqual(products[0].variants[0].unitCost, 450);
  });
});
