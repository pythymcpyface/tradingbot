
import { 
  toGlicko2Scale, 
  fromGlicko2Scale, 
  g, 
  E, 
  calculateVariance,
  GLICKO_SCALE,
  INITIAL_RATING
} from '../src/utils/GlickoMath';

describe('GlickoMath Utilities', () => {
  describe('Scale Conversion', () => {
    test('converts standard rating 1500 to internal mu 0', () => {
      const { mu, phi } = toGlicko2Scale(1500, 350);
      expect(mu).toBeCloseTo(0);
      expect(phi).toBeCloseTo(350 / GLICKO_SCALE);
    });

    test('converts internal mu 0 back to standard rating 1500', () => {
      const phiFor350 = 350 / GLICKO_SCALE; 
      const { rating, rd } = fromGlicko2Scale(0, phiFor350);
      expect(rating).toBeCloseTo(1500);
      expect(rd).toBeCloseTo(350);
    });

    test('round trip conversion preserves values', () => {
      const startRating = 2200;
      const startRD = 50;
      const { mu, phi } = toGlicko2Scale(startRating, startRD);
      const { rating, rd } = fromGlicko2Scale(mu, phi);
      expect(rating).toBeCloseTo(startRating);
      expect(rd).toBeCloseTo(startRD);
    });
  });

  describe('g(phi) Weighting Function', () => {
    test('g(0) should be 1', () => {
      // If opponent has 0 uncertainty, weight is max (1)
      expect(g(0)).toBeCloseTo(1);
    });

    test('g(phi) decreases as phi increases', () => {
      const g1 = g(0.5);
      const g2 = g(1.0);
      expect(g1).toBeGreaterThan(g2);
    });
  });

  describe('E(mu, muJ, phiJ) Expected Score', () => {
    test('Expected score is 0.5 for equal ratings and zero deviation', () => {
      // mu = 0 (1500), muJ = 0 (1500), phiJ = 0
      expect(E(0, 0, 0)).toBeCloseTo(0.5);
    });

    test('Expected score > 0.5 when player rating > opponent rating', () => {
      // Player 1700 vs Opponent 1500
      const muPlayer = (1700 - 1500) / GLICKO_SCALE;
      const muOpp = 0;
      const phiOpp = 350 / GLICKO_SCALE;
      expect(E(muPlayer, muOpp, phiOpp)).toBeGreaterThan(0.5);
    });

    test('Expected score < 0.5 when player rating < opponent rating', () => {
      const muPlayer = (1300 - 1500) / GLICKO_SCALE;
      const muOpp = 0;
      const phiOpp = 350 / GLICKO_SCALE;
      expect(E(muPlayer, muOpp, phiOpp)).toBeLessThan(0.5);
    });
  });

  describe('Variance Calculation', () => {
    test('Variance is positive', () => {
      const mu = 0;
      const opponents = [
        { mu: 0, phi: 350 / GLICKO_SCALE },
        { mu: -1, phi: 350 / GLICKO_SCALE }
      ];
      const v = calculateVariance(mu, opponents);
      expect(v).toBeGreaterThan(0);
    });

    test('Weight increases the influence on variance', () => {
      const mu = 0;
      const opponent = { mu: 1, phi: 350 / GLICKO_SCALE };
      
      const v1 = calculateVariance(mu, [{ ...opponent, weight: 1.0 }]);
      const v2 = calculateVariance(mu, [{ ...opponent, weight: 2.0 }]);
      
      // Higher weight means higher vInv, so lower v
      expect(v2).toBeLessThan(v1);
    });
  });

  describe('Delta Calculation', () => {
    test('Weight increases the influence on delta', () => {
      const mu = 0;
      const v = 0.5;
      const opponent = { mu: 1, phi: 350 / GLICKO_SCALE, score: 1.0 };
      
      const { calculateDelta } = require('../src/utils/GlickoMath');
      const d1 = calculateDelta(v, mu, [{ ...opponent, weight: 1.0 }]);
      const d2 = calculateDelta(v, mu, [{ ...opponent, weight: 2.0 }]);
      
      expect(Math.abs(d2)).toBeGreaterThan(Math.abs(d1));
    });
  });
});
