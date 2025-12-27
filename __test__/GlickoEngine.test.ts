
import { GlickoEngine } from '../src/services/GlickoEngine';
import { INITIAL_RATING } from '../src/utils/GlickoMath';

describe('GlickoEngine', () => {
  let engine: GlickoEngine;
  const START_DATE = new Date('2024-01-01');

  beforeEach(() => {
    engine = new GlickoEngine();
  });

  describe('Initialization', () => {
    test('creates new coin state on demand', () => {
      engine.ensureCoinExists('BTC', START_DATE);
      const state = engine.getCoinState('BTC');
      expect(state).toBeDefined();
      expect(state?.symbol).toBe('BTC');
      expect(state?.rating.rating).toBe(INITIAL_RATING);
      expect(state?.matchesPlayed).toBe(0);
    });
  });

  describe('Game Processing', () => {
    test('updates ratings correctly when Base wins', () => {
      engine.ensureCoinExists('BTC', START_DATE);
      engine.ensureCoinExists('ETH', START_DATE);

      // BTC vs ETH, BTC price goes up 2% -> Win
      engine.processGame('BTC', 'ETH', 0.02, START_DATE);

      const btc = engine.getCoinState('BTC')!;
      const eth = engine.getCoinState('ETH')!;

      // BTC should gain rating
      expect(btc.rating.rating).toBeGreaterThan(INITIAL_RATING);
      // ETH should lose rating
      expect(eth.rating.rating).toBeLessThan(INITIAL_RATING);
      
      expect(btc.matchesPlayed).toBe(1);
      expect(eth.matchesPlayed).toBe(1);
    });

    test('updates ratings correctly when Base loses', () => {
      engine.ensureCoinExists('BTC', START_DATE);
      engine.ensureCoinExists('ETH', START_DATE);

      // BTC vs ETH, BTC price goes down 2% -> Loss
      engine.processGame('BTC', 'ETH', -0.02, START_DATE);

      const btc = engine.getCoinState('BTC')!;
      const eth = engine.getCoinState('ETH')!;

      // BTC should lose rating
      expect(btc.rating.rating).toBeLessThan(INITIAL_RATING);
      // ETH should gain rating
      expect(eth.rating.rating).toBeGreaterThan(INITIAL_RATING);
    });

    test('handles draws correctly (small price change)', () => {
        engine.ensureCoinExists('BTC', START_DATE);
        engine.ensureCoinExists('ETH', START_DATE);
  
        // 0% change -> Draw (score 0.5)
        engine.processGame('BTC', 'ETH', 0.0, START_DATE);
  
        const btc = engine.getCoinState('BTC')!;
        const eth = engine.getCoinState('ETH')!;
  
        expect(btc.rating.rating).toBeCloseTo(INITIAL_RATING, 1);
        expect(eth.rating.rating).toBeCloseTo(INITIAL_RATING, 1);
      });

    test('volume dominance influences the result when price is flat', () => {
      engine.ensureCoinExists('BTC', START_DATE);
      engine.ensureCoinExists('ETH', START_DATE);

      // Price is flat (0.0), but BTC has 100% buy volume dominance
      // PriceScore = 0.5, VolumeScore = 1.0
      // HybridScore = 0.7*0.5 + 0.3*1.0 = 0.35 + 0.3 = 0.65 (Bullish for BTC)
      engine.processGame('BTC', 'ETH', 0.0, START_DATE, { volume: 1000, takerBuyVolume: 1000 });

      const btc = engine.getCoinState('BTC')!;
      expect(btc.rating.rating).toBeGreaterThan(INITIAL_RATING);
    });

    test('volume dominance can mitigate a small price loss', () => {
      engine.ensureCoinExists('BTC', START_DATE);
      engine.ensureCoinExists('ETH', START_DATE);

      // BTC price drops slightly (-0.1%), but has huge buy volume
      // PriceScore = 0.5 + (-0.001 * 50) = 0.45
      // VolumeScore = 1.0 (100% buys)
      // HybridScore = 0.7*0.45 + 0.3*1.0 = 0.315 + 0.3 = 0.615 (Still bullish!)
      engine.processGame('BTC', 'ETH', -0.001, START_DATE, { volume: 1000, takerBuyVolume: 1000 });

      const btc = engine.getCoinState('BTC')!;
      expect(btc.rating.rating).toBeGreaterThan(INITIAL_RATING);
    });

    test('extreme sell volume dominance influences the result', () => {
      engine.ensureCoinExists('BTC', START_DATE);
      engine.ensureCoinExists('ETH', START_DATE);

      // Price is flat, but 100% sell volume (0% buy)
      // HybridScore = 0.7*0.5 + 0.3*0.0 = 0.35 (Bearish for BTC)
      engine.processGame('BTC', 'ETH', 0.0, START_DATE, { volume: 1000, takerBuyVolume: 0 });

              const btc = engine.getCoinState('BTC')!;
            expect(btc.rating.rating).toBeLessThan(INITIAL_RATING);
          });
        });
      
          describe('RD Decay', () => {
            test('applyDecay increases RD due to uncertainty', () => {
              // Create a coin and simulate a game to reduce its RD
              engine.ensureCoinExists('STALE', START_DATE);
              engine.processGame('STALE', 'OTHER', 0.01, START_DATE); 
              
              const midRD = engine.getCoinState('STALE')!.rating.ratingDeviation;
              expect(midRD).toBeLessThan(350);
              
              engine.applyDecay('STALE');
              
              const updatedRD = engine.getCoinState('STALE')!.rating.ratingDeviation;
              expect(updatedRD).toBeGreaterThan(midRD);
            });
          });  describe('Volatility Handling', () => {
      test('volatility changes after unexpected result', () => {
          // Setup: High rated player vs Low rated player
          // If High rated player LOSES, volatility should increase?
          
          // Manually set up states
          // We can't inject state easily unless we use constructor, testing constructor injection
          const highRating = { symbol: 'HIGH', rating: { rating: 2000, ratingDeviation: 50, volatility: 0.06 }, matchesPlayed: 10, lastUpdate: START_DATE };
          const lowRating = { symbol: 'LOW', rating: { rating: 1200, ratingDeviation: 50, volatility: 0.06 }, matchesPlayed: 10, lastUpdate: START_DATE };
          
          const customEngine = new GlickoEngine([highRating, lowRating]);
          
          // HIGH loses to LOW (Low beats High)
          // Price change -5% for HIGH
          customEngine.processGame('HIGH', 'LOW', -0.05, START_DATE);
          
          const newHigh = customEngine.getCoinState('HIGH')!;
          
          // Expect volatility to increase because the result was unexpected
          // (2000 vs 1200, 2000 expected to win)
          expect(newHigh.rating.volatility).toBeGreaterThan(0.06);
      });
  });
  
  describe('Bounds Checking', () => {
      test('ratings are clamped to max', () => {
        // Force a sequence of wins to push rating up
        engine.ensureCoinExists('WINNER', START_DATE);
        engine.ensureCoinExists('LOSER', START_DATE);
        
        // Simulate 100 wins
        for (let i = 0; i < 100; i++) {
            engine.processGame('WINNER', 'LOSER', 0.10, START_DATE); // 10% win every time
        }
        
        const winner = engine.getCoinState('WINNER')!;
        expect(winner.rating.rating).toBeLessThanOrEqual(3000);
      });
  });
});
