/**
 * Unit Tests for SKU Generator
 * 
 * Tests the core SKU generation algorithm with all examples from requirements.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  convertDigit,
  generateBaseSku,
  ensureUniqueSku,
  generateSku,
  generateSkuBatch,
  isValidSku,
} from '../src/services/skuGenerator.js';

describe('SKU Generator', () => {
  describe('convertDigit', () => {
    it('should convert digits to correct letters', () => {
      assert.strictEqual(convertDigit('1'), 'A');
      assert.strictEqual(convertDigit('2'), 'B');
      assert.strictEqual(convertDigit('3'), 'C');
      assert.strictEqual(convertDigit('4'), 'D');
      assert.strictEqual(convertDigit('5'), 'E');
      assert.strictEqual(convertDigit('6'), 'F');
      assert.strictEqual(convertDigit('7'), 'G');
      assert.strictEqual(convertDigit('8'), 'H');
      assert.strictEqual(convertDigit('9'), 'I');
      assert.strictEqual(convertDigit('0'), '0');
    });

    it('should throw on invalid digit', () => {
      assert.throws(() => convertDigit('a'), /Invalid digit/);
      assert.throws(() => convertDigit(''), /Invalid digit/);
    });
  });

  describe('generateBaseSku', () => {
    it('should add 22% to cost before processing', () => {
      // 450 * 1.22 = 549 -> reversed "945" -> pos0=9->I, pos1=4, pos2=5->E = "I4E"
      const result = generateBaseSku(450);
      assert.strictEqual(result, 'I4E');
    });

    it('should handle 1200 -> 1200*1.22=1464 -> "4641" -> pos0=4->D, pos1=6, pos2=4->D, pos3=1 = "D6D1"', () => {
      const result = generateBaseSku(1200);
      assert.strictEqual(result, 'D6D1');
    });

    it('should handle 900 -> 900*1.22=1098 -> "8901" -> pos0=8->H, pos1=9, pos2=0->0, pos3=1 = "H901"', () => {
      const result = generateBaseSku(900);
      assert.strictEqual(result, 'H901');
    });

    it('should handle 800 -> 800*1.22=976 -> "679" -> pos0=6->F, pos1=7, pos2=9->I = "F7I"', () => {
      const result = generateBaseSku(800);
      assert.strictEqual(result, 'F7I');
    });

    it('should handle decimal costs (integer portion only)', () => {
      // 450.99 -> floor = 450 -> 450*1.22 = 549 -> "I4E"
      assert.strictEqual(generateBaseSku(450.99), 'I4E');
    });

    it('should handle string inputs', () => {
      assert.strictEqual(generateBaseSku('450'), 'I4E');
    });

    it('should return null for invalid inputs', () => {
      assert.strictEqual(generateBaseSku(null), null);
      assert.strictEqual(generateBaseSku(undefined), null);
      assert.strictEqual(generateBaseSku(''), null);
      assert.strictEqual(generateBaseSku(-1), null);
      assert.strictEqual(generateBaseSku(NaN), null);
    });

    it('should handle zero cost', () => {
      // 0 * 1.22 = 0 -> "0" -> pos0=0->0 = "0"
      assert.strictEqual(generateBaseSku(0), '0');
    });

    it('should handle single digit costs', () => {
      // 5 * 1.22 = 6.1 -> floor = 6 -> "6" -> pos0=6->F = "F"
      assert.strictEqual(generateBaseSku(5), 'F');
      // 1 * 1.22 = 1.22 -> floor = 1 -> "1" -> pos0=1->A = "A"
      assert.strictEqual(generateBaseSku(1), 'A');
    });
  });

  describe('ensureUniqueSku', () => {
    it('should return base SKU if not used', () => {
      const used = new Set();
      assert.strictEqual(ensureUniqueSku('I4E', used), 'I4E');
      assert.ok(used.has('I4E'));
    });

    it('should append suffix for duplicate base SKU', () => {
      const used = new Set(['I4E']);
      assert.strictEqual(ensureUniqueSku('I4E', used), 'I4E-01');
      assert.ok(used.has('I4E-01'));
    });

    it('should increment suffix for multiple duplicates', () => {
      const used = new Set(['I4E', 'I4E-01', 'I4E-02']);
      assert.strictEqual(ensureUniqueSku('I4E', used), 'I4E-03');
    });
  });

  describe('generateSku', () => {
    it('should generate unique SKU and track it', () => {
      const used = new Set();
      const sku1 = generateSku(450, used);
      const sku2 = generateSku(450, used);

      assert.strictEqual(sku1, 'I4E');
      assert.strictEqual(sku2, 'I4E-01');
      assert.ok(used.has('I4E'));
      assert.ok(used.has('I4E-01'));
    });
  });

  describe('generateSkuBatch', () => {
    it('should generate SKUs for multiple items', () => {
      const items = [
        { id: '1', cost: 450 },
        { id: '2', cost: 450 },
        { id: '3', cost: 1200 },
      ];

      const result = generateSkuBatch(items);

      assert.strictEqual(result.get('1'), 'I4E');
      assert.strictEqual(result.get('2'), 'I4E-01');
      assert.strictEqual(result.get('3'), 'D6D1');
    });
  });

  describe('isValidSku', () => {
    it('should validate correct SKU formats', () => {
      assert.strictEqual(isValidSku('I4E'), true);
      assert.strictEqual(isValidSku('D6D1'), true);
      assert.strictEqual(isValidSku('I4E-01'), true);
      assert.strictEqual(isValidSku('ABC123'), true);
    });

    it('should reject invalid formats', () => {
      assert.strictEqual(isValidSku(null), false);
      assert.strictEqual(isValidSku(''), false);
      assert.strictEqual(isValidSku('abc'), false); // lowercase
    });
  });
});
