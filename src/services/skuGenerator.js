/**
 * SKU Generator Utility
 * 
 * Reusable utility for generating SKUs from Cost Per Item.
 * Algorithm:
 * 1. Read Cost Per Item (e.g., 450)
 * 2. Add 22% to cost price (450 * 1.22 = 549)
 * 3. Reverse digits (549 -> "945")
 * 4. Convert digits at even positions (0, 2, 4...) to letters
 * 5. Return the resulting string
 * 
 * This module is completely decoupled from Shopify API and can be
 * imported and used independently.
 */

/**
 * Digit-to-letter mapping
 * 1 -> A, 2 -> B, 3 -> C, 4 -> D, 5 -> E, 6 -> F, 7 -> G, 8 -> H, 9 -> I, 0 -> 0
 */
const DIGIT_TO_LETTER = {
  '0': '0',
  '1': 'A',
  '2': 'B',
  '3': 'C',
  '4': 'D',
  '5': 'E',
  '6': 'F',
  '7': 'G',
  '8': 'H',
  '9': 'I',
};

/**
 * Convert a single digit to its mapped letter
 * @param {string} digit - Single digit character
 * @returns {string} - Mapped character
 */
export function convertDigit(digit) {
  if (DIGIT_TO_LETTER[digit] === undefined) {
    throw new Error(`Invalid digit: ${digit}. Must be 0-9.`);
  }
  return DIGIT_TO_LETTER[digit];
}

/**
 * Generate base SKU from cost per item
 * Algorithm:
 * 1. Extract integer portion of cost (e.g., 450.99 -> 450)
 * 2. Add 22% (450 * 1.22 = 549)
 * 3. Convert to integer (floor)
 * 4. Reverse digits (549 -> "945")
 * 5. Convert digits at even positions (0, 2, 4...) to letters
 * 6. Return the resulting string
 * 
 * @param {number|string} cost - Cost per item (e.g., 450, 450.99, "450")
 * @returns {string|null} - Base SKU (e.g., "I4D")
 */
export function generateBaseSku(cost) {
  if (cost === null || cost === undefined || cost === '') {
    return null;
  }

  // Extract integer portion
  const costNum = typeof cost === 'string' ? parseFloat(cost) : cost;
  if (isNaN(costNum) || costNum < 0) {
    return null;
  }

  const intCost = Math.floor(costNum);

  // Add 22% to cost price
  const adjustedCost = Math.floor(intCost * 1.22);

  // Convert to string and reverse
  const reversed = String(adjustedCost).split('').reverse().join('');

  // Convert alternate digits (even positions: 0, 2, 4...)
  let result = '';
  for (let i = 0; i < reversed.length; i++) {
    const digit = reversed[i];
    if (i % 2 === 0) {
      // Even position: convert to letter
      result += convertDigit(digit);
    } else {
      // Odd position: keep as digit
      result += digit;
    }
  }

  return result;
}

/**
 * Ensure SKU uniqueness by appending sequential suffix
 * @param {string} baseSku - Base SKU (e.g., "I4D")
 * @param {Set<string>} usedSkus - Set of already used SKUs
 * @returns {string} - Unique SKU (e.g., "I4D-01")
 */
export function ensureUniqueSku(baseSku, usedSkus) {
  if (!usedSkus.has(baseSku)) {
    usedSkus.add(baseSku);
    return baseSku;
  }

  let suffix = 1;
  let uniqueSku = `${baseSku}-${String(suffix).padStart(2, '0')}`;

  while (usedSkus.has(uniqueSku)) {
    suffix++;
    uniqueSku = `${baseSku}-${String(suffix).padStart(2, '0')}`;
  }

  usedSkus.add(uniqueSku);
  return uniqueSku;
}

/**
 * Generate a unique SKU from cost per item
 * Main entry point for SKU generation
 * 
 * @param {number|string} cost - Cost per item
 * @param {Set<string>} usedSkus - Set of already used SKUs (modified in place)
 * @returns {string|null} - Unique SKU or null if cost is invalid
 */
export function generateSku(cost, usedSkus = new Set()) {
  const baseSku = generateBaseSku(cost);
  if (!baseSku) {
    return null;
  }

  return ensureUniqueSku(baseSku, usedSkus);
}

/**
 * Generate multiple SKUs in batch
 * Useful for processing many products at once
 * 
 * @param {Array<{id: string, cost: number}>} items - Array of items with cost
 * @param {Set<string>} existingSkus - Set of existing SKUs to avoid conflicts
 * @returns {Map<string, string>} - Map of item ID to generated SKU
 */
export function generateSkuBatch(items, existingSkus = new Set()) {
  const usedSkus = new Set(existingSkus);
  const result = new Map();

  for (const item of items) {
    const sku = generateSku(item.cost, usedSkus);
    if (sku) {
      result.set(item.id, sku);
    }
  }

  return result;
}

/**
 * Validate a SKU format
 * @param {string} sku - SKU to validate
 * @returns {boolean} - True if valid SKU format
 */
export function isValidSku(sku) {
  if (!sku || typeof sku !== 'string') return false;
  // Valid format: alphanumeric with optional -XX suffix
  return /^[A-Z0-9]+(-\d{2,})?$/.test(sku);
}

export default {
  generateBaseSku,
  ensureUniqueSku,
  generateSku,
  generateSkuBatch,
  convertDigit,
  isValidSku,
};
