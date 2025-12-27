export interface OCOPrices {
  takeProfitPrice: number;
  stopLossPrice: number;
  stopLimitPrice: number;
}

export interface OCOCheckResult {
  triggered: boolean;
  type: 'TAKE_PROFIT' | 'STOP_LOSS' | 'NONE';
  exitPrice?: number;
}

export class OCOOrderService {
  private readonly STOP_LIMIT_BUFFER = 0.001; // 0.1% buffer below stop loss for limit execution

  calculateOCOPrices(
    entryPrice: number,
    profitPercent: number,
    stopLossPercent: number
  ): OCOPrices {
    if (entryPrice <= 0) {
      throw new Error('Entry price must be greater than 0');
    }
    if (profitPercent <= 0) {
      throw new Error('Profit percent must be greater than 0');
    }
    if (stopLossPercent <= 0) {
      throw new Error('Stop loss percent must be greater than 0');
    }

    const takeProfitPrice = entryPrice * (1 + profitPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    const stopLimitPrice = entryPrice * (1 - stopLossPercent / 100 - this.STOP_LIMIT_BUFFER);

    return {
      takeProfitPrice,
      stopLossPrice,
      stopLimitPrice
    };
  }

  formatPriceForBinance(price: number, decimals: number = 8): string {
    return price.toFixed(decimals);
  }

  checkOCOCondition(
    currentPrice: number,
    takeProfitPrice: number,
    stopLossPrice: number
  ): OCOCheckResult {
    if (currentPrice >= takeProfitPrice) {
      return {
        triggered: true,
        type: 'TAKE_PROFIT',
        exitPrice: takeProfitPrice
      };
    }

    if (currentPrice <= stopLossPrice) {
      return {
        triggered: true,
        type: 'STOP_LOSS',
        exitPrice: stopLossPrice
      };
    }

    return {
      triggered: false,
      type: 'NONE'
    };
  }

  calculateProfitLoss(
    entryPrice: number,
    exitPrice: number,
    quantity: number
  ): {
    pnl: number;
    pnlPercent: number;
  } {
    const entryValue = entryPrice * quantity;
    const exitValue = exitPrice * quantity;
    const pnl = exitValue - entryValue;
    const pnlPercent = (pnl / entryValue) * 100;

    return {
      pnl,
      pnlPercent
    };
  }

  validateOCOPrices(
    entryPrice: number,
    takeProfitPrice: number,
    stopLossPrice: number
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (takeProfitPrice <= entryPrice) {
      errors.push(`Take profit price (${takeProfitPrice}) must be greater than entry price (${entryPrice})`);
    }

    if (stopLossPrice >= entryPrice) {
      errors.push(`Stop loss price (${stopLossPrice}) must be less than entry price (${entryPrice})`);
    }

    if (stopLossPrice <= 0) {
      errors.push(`Stop loss price (${stopLossPrice}) must be greater than 0`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  calculateAllocationAmount(
    totalBalance: number,
    allocationPercent: number
  ): number {
    if (totalBalance < 0) {
      throw new Error('Total balance must be greater than or equal to 0');
    }
    if (allocationPercent <= 0 || allocationPercent > 100) {
      throw new Error('Allocation percent must be between 0 and 100');
    }

    return totalBalance * (allocationPercent / 100);
  }

  calculatePositionSize(
    allocationAmount: number,
    entryPrice: number
  ): number {
    if (allocationAmount <= 0) {
      throw new Error('Allocation amount must be greater than 0');
    }
    if (entryPrice <= 0) {
      throw new Error('Entry price must be greater than 0');
    }

    return allocationAmount / entryPrice;
  }
}
