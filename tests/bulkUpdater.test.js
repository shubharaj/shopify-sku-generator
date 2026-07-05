import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { updateInventoryItemSku } from '../src/services/bulkUpdater.js';

describe('Bulk Updater', () => {
  const originalFetch = global.fetch;
  let requestBody;

  beforeEach(() => {
    requestBody = null;
    global.fetch = async (url, init) => {
      if (url.includes('/admin/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'test-token', expires_in: 3600, scope: 'write_inventory' }),
        };
      }

      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          data: {
            inventoryItemUpdate: {
              inventoryItem: { id: 'gid://shopify/InventoryItem/1', sku: 'ABC' },
              userErrors: [],
            },
          },
        }),
      };
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('updates the inventory item SKU using the inventory item id', async () => {
    const result = await updateInventoryItemSku('gid://shopify/InventoryItem/1', 'ABC');

    assert.strictEqual(result.success, true);
    assert.match(requestBody.query, /inventoryItemUpdate/);
    assert.strictEqual(requestBody.variables.id, 'gid://shopify/InventoryItem/1');
    assert.strictEqual(requestBody.variables.input.sku, 'ABC');
  });
});