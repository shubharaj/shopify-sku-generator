// utils/diagnostic.js
import { graphqlRequest } from '../config/shopify.js';
import { getAccessToken, getTokenStatus } from './tokenManager.js';

async function diagnose() {
  const token = await getAccessToken();
  
  console.log('=== Shopify SKU Generator Diagnostic ===\n');

  // Test 1: API connectivity
  console.log('Test 1: Checking API connectivity...');
  try {
    const result = await graphqlRequest(`
      query { shop { name id } }
    `, {}, token);
    console.log('✅ API Connection OK. Shop name:', result.data.shop.name, '\n');
  } catch (e) {
    console.log('❌ API Connection Failed:', e.message, '\n');
    return;
  }

  // Test 2: Check token scopes
  console.log('Test 2: Checking token status...');
  console.log('Token status:', getTokenStatus(), '\n');

  // Test 3: Fetch a real product and variant to test with
  console.log('Test 3: Fetching a product to test mutation...');
  let testProductId, testVariantId, testInventoryItemId;
  try {
    const productQuery = await graphqlRequest(`
      query {
        products(first: 1) {
          edges {
            node {
              id
              title
              variants(first: 1) {
                edges {
                  node {
                    id
                    sku
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {}, token);

    const product = productQuery.data?.products?.edges?.[0]?.node;
    testProductId = product?.id;
    const variant = product?.variants?.edges?.[0]?.node;
    testVariantId = variant?.id;
    testInventoryItemId = variant?.inventoryItem?.id;

    if (!testVariantId || !testInventoryItemId) {
      console.log('⚠️ No variants/inventory items found in store to test with\n');
      return;
    }
    console.log('Found product:', product.title);
    console.log('Product ID:', testProductId);
    console.log('Variant ID:', testVariantId);
    console.log('Inventory Item ID:', testInventoryItemId, '\n');
  } catch (e) {
    console.log('❌ Failed to fetch products:', e.message, '\n');
    return;
  }

  // Test 4: Test inventoryItemUpdate mutation (the CORRECT way to update SKU)
  console.log('Test 4: Testing inventoryItemUpdate mutation...');
  const testSku = 'TEST-SKU-' + Date.now();
  try {
    const result = await graphqlRequest(`
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
    `, { 
      id: testInventoryItemId, 
      input: { sku: testSku } 
    }, token);

    console.log('Mutation result:', JSON.stringify(result, null, 2));

    if (result.data?.inventoryItemUpdate?.userErrors?.length > 0) {
      console.log('❌ User Errors:', result.data.inventoryItemUpdate.userErrors);
    } else if (result.data?.inventoryItemUpdate?.inventoryItem) {
      const updated = result.data.inventoryItemUpdate.inventoryItem;
      console.log('✅ Mutation succeeded! SKU updated to:', updated.sku);
    } else {
      console.log('⚠️ Unexpected response structure');
    }
  } catch (e) {
    console.log('❌ Mutation Failed:', e.message);
    if (e.code) console.log('Error code:', e.code);
    if (e.extensions) console.log('Extensions:', JSON.stringify(e.extensions, null, 2));
  }

  console.log('\n=== Diagnostic Complete ===');
}

diagnose().catch(err => {
  console.error('Diagnostic crashed:', err);
  process.exit(1);
});