import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dotProduct } from '../../src/utils/math';

describe('Math Utilities - Dot Product', () => {
    it('should compute exact dot product for identical unit vectors', () => {
        const vecA = [1, 0, 0];
        const vecB = [1, 0, 0];
        const result = dotProduct(vecA, vecB);
        assert.equal(result, 1);
    });

    it('should return 0 for orthogonal vectors', () => {
        const vecA = [1, 0, 0];
        const vecB = [0, 1, 0];
        const result = dotProduct(vecA, vecB);
        assert.equal(result, 0);
    });

    it('should return -1 for opposite unit vectors', () => {
        const vecA = [1, 0];
        const vecB = [-1, 0];
        const result = dotProduct(vecA, vecB);
        assert.equal(result, -1);
    });

    it('should throw an error on dimension mismatch', () => {
        const vecA = [1, 2, 3];
        const vecB = [1, 2];
        assert.throws(() => {
            dotProduct(vecA, vecB);
        }, /Vector dimensions do not match/);
    });
});
