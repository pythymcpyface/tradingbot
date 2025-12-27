import { ZScoreSignal, TradingParameterSet } from '../types';

export interface RatingInput {
  symbol: string;
  rating: number;
  timestamp: Date;
}

export interface ZScoreHistory {
  timestamp: Date;
  zScore: number;
  rating: number;
}

export interface SignalGeneratorConfig {
  zScoreThreshold: number;
  movingAveragesPeriod: number;
}

export interface CrossCoinStatistics {
  meanRating: number;
  stdDevRating: number;
  totalCoins: number;
}

export class SignalGeneratorService {
  private zScoreHistory: Map<string, ZScoreHistory[]> = new Map();

  constructor() {}

  calculateCrossCoinStatistics(ratings: RatingInput[]): CrossCoinStatistics {
    if (ratings.length === 0) {
      return {
        meanRating: 0,
        stdDevRating: 0,
        totalCoins: 0
      };
    }

    const allRatingValues = ratings.map(r => r.rating);
    const meanRating = allRatingValues.reduce((sum, rating) => sum + rating, 0) / allRatingValues.length;
    const variance = allRatingValues.reduce((sum, rating) => sum + Math.pow(rating - meanRating, 2), 0) / allRatingValues.length;
    const stdDevRating = Math.sqrt(variance);

    return {
      meanRating,
      stdDevRating,
      totalCoins: ratings.length
    };
  }

  calculateZScore(rating: number, meanRating: number, stdDevRating: number): number {
    if (stdDevRating === 0) {
      return 0;
    }
    return (rating - meanRating) / stdDevRating;
  }

  updateZScoreHistory(
    symbol: string,
    zScore: number,
    rating: number,
    timestamp: Date,
    maxHistoryLength: number = 250
  ): void {
    if (!this.zScoreHistory.has(symbol)) {
      this.zScoreHistory.set(symbol, []);
    }

    const history = this.zScoreHistory.get(symbol)!;
    history.push({
      timestamp,
      zScore,
      rating
    });

    if (history.length > maxHistoryLength) {
      history.shift();
    }
  }

  calculateMovingAverageZScore(symbol: string, period: number): number | null {
    const history = this.zScoreHistory.get(symbol);

    if (!history || history.length < period) {
      return null;
    }

    const recentZScores = history.slice(-period);
    return recentZScores.reduce((sum, h) => sum + h.zScore, 0) / recentZScores.length;
  }

  getZScoreHistory(symbol: string): ZScoreHistory[] {
    return this.zScoreHistory.get(symbol) || [];
  }

  getZScoreHistoryLength(symbol: string): number {
    return this.zScoreHistory.get(symbol)?.length || 0;
  }

  generateSignal(
    symbol: string,
    movingAverageZScore: number,
    zScoreThreshold: number
  ): 'BUY' | 'SELL' | 'HOLD' {
    if (Math.abs(movingAverageZScore) >= zScoreThreshold) {
      return movingAverageZScore > 0 ? 'BUY' : 'SELL';
    }
    return 'HOLD';
  }

  generateSignals(
    ratings: RatingInput[],
    parameterSets: Map<string, TradingParameterSet>
  ): {
    signals: ZScoreSignal[];
    statistics: CrossCoinStatistics;
    zScores: Map<string, {
      current: number;
      movingAverage: number | null;
      historyLength: number;
    }>;
  } {
    const statistics = this.calculateCrossCoinStatistics(ratings);
    const signals: ZScoreSignal[] = [];
    const zScores = new Map<string, {
      current: number;
      movingAverage: number | null;
      historyLength: number;
    }>();

    for (const rating of ratings) {
      const tradingSymbol = `${rating.symbol}USDT`;

      const currentZScore = this.calculateZScore(
        rating.rating,
        statistics.meanRating,
        statistics.stdDevRating
      );

      this.updateZScoreHistory(
        tradingSymbol,
        currentZScore,
        rating.rating,
        rating.timestamp
      );

      const params = parameterSets.get(tradingSymbol);
      if (!params || !params.enabled) {
        continue;
      }

      const movingAverageZScore = this.calculateMovingAverageZScore(
        tradingSymbol,
        params.movingAverages
      );

      if (movingAverageZScore === null) {
        continue;
      }

      const signal = this.generateSignal(
        tradingSymbol,
        movingAverageZScore,
        params.zScoreThreshold
      );

      zScores.set(tradingSymbol, {
        current: currentZScore,
        movingAverage: movingAverageZScore,
        historyLength: this.getZScoreHistoryLength(tradingSymbol)
      });

      if (signal !== 'HOLD') {
        signals.push({
          symbol: tradingSymbol,
          timestamp: rating.timestamp,
          currentRating: rating.rating,
          movingAverage: statistics.meanRating,
          standardDeviation: statistics.stdDevRating,
          zScore: movingAverageZScore,
          signal: signal as 'BUY' | 'SELL'
        });
      }
    }

    return {
      signals,
      statistics,
      zScores
    };
  }

  ensureMinimumHistory(
    symbol: string,
    requiredPeriod: number,
    allRatings: RatingInput[],
    statistics: CrossCoinStatistics
  ): void {
    const currentHistory = this.getZScoreHistoryLength(symbol);

    if (currentHistory >= requiredPeriod) {
      return;
    }

    const symbolRating = allRatings.find(r => `${r.symbol}USDT` === symbol);
    if (!symbolRating) {
      return;
    }

    const baseSymbol = symbol.replace('USDT', '');
    const zScore = this.calculateZScore(
      symbolRating.rating,
      statistics.meanRating,
      statistics.stdDevRating
    );

    const deficit = requiredPeriod - currentHistory;
    for (let i = 0; i < deficit; i++) {
      const backfilledTimestamp = new Date(
        symbolRating.timestamp.getTime() - (deficit - i) * 60 * 60 * 1000
      );
      this.updateZScoreHistory(
        symbol,
        zScore,
        symbolRating.rating,
        backfilledTimestamp
      );
    }
  }

  clearHistory(): void {
    this.zScoreHistory.clear();
  }

  clearSymbolHistory(symbol: string): void {
    this.zScoreHistory.delete(symbol);
  }
}
