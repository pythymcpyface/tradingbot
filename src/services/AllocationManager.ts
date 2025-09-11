/**
 * AllocationManager - Manages account balance allocation for parameter sets
 * 
 * This service ensures that:
 * 1. Each parameter set gets its reserved portion of the account
 * 2. No overallocation occurs when multiple signals trigger simultaneously  
 * 3. Reserved funds are protected until positions are closed
 * 4. Balance tracking is accurate across concurrent trades
 */

export interface AllocationReservation {
  symbol: string;
  reservedAmount: number;
  timestamp: Date;
  orderId?: string;
}

export class AllocationManager {
  private reservations: Map<string, AllocationReservation> = new Map();
  private totalAccountBalance: number = 0;
  private lastBalanceUpdate: Date = new Date(0);

  constructor() {}

  /**
   * Initialize with current account balance
   */
  async initialize(binanceService: any): Promise<void> {
    await this.updateAccountBalance(binanceService);
  }

  /**
   * Update the total account balance from Binance
   */
  async updateAccountBalance(binanceService: any): Promise<number> {
    try {
      const account = await binanceService.getAccountInfo();
      const usdtBalance = account.balances.find((b: any) => b.asset === 'USDT');
      this.totalAccountBalance = parseFloat(usdtBalance?.free || '0');
      this.lastBalanceUpdate = new Date();
      
      console.log(`💰 Account balance updated: $${this.totalAccountBalance.toFixed(2)}`);
      return this.totalAccountBalance;
    } catch (error) {
      console.error('Failed to update account balance:', error);
      throw error;
    }
  }

  /**
   * Reserve funds for a parameter set trade
   * Returns the exact amount available for this symbol's allocation
   */
  async reserveFunds(
    symbol: string, 
    allocationPercent: number, 
    binanceService: any
  ): Promise<{ success: boolean; amount: number; reason?: string }> {
    
    // Get fresh balance
    await this.updateAccountBalance(binanceService);
    
    // Check if already reserved for this symbol
    if (this.reservations.has(symbol)) {
      return {
        success: false,
        amount: 0,
        reason: `Funds already reserved for ${symbol}`
      };
    }

    // Calculate allocation amount based on ORIGINAL account balance
    // This ensures each parameter set gets its fair share
    const allocationAmount = this.totalAccountBalance * (allocationPercent / 100);
    
    // Check if enough funds available (considering existing reservations)
    const totalReserved = Array.from(this.reservations.values())
      .reduce((sum, res) => sum + res.reservedAmount, 0);
    const availableForReservation = this.totalAccountBalance - totalReserved;

    if (allocationAmount > availableForReservation) {
      return {
        success: false,
        amount: 0,
        reason: `Insufficient funds: need $${allocationAmount.toFixed(2)}, available $${availableForReservation.toFixed(2)}`
      };
    }

    // Reserve the funds
    const reservation: AllocationReservation = {
      symbol,
      reservedAmount: allocationAmount,
      timestamp: new Date()
    };

    this.reservations.set(symbol, reservation);
    
    console.log(`💼 Reserved $${allocationAmount.toFixed(2)} (${allocationPercent}%) for ${symbol}`);
    console.log(`💼 Total reserved: $${(totalReserved + allocationAmount).toFixed(2)} / $${this.totalAccountBalance.toFixed(2)}`);

    return {
      success: true,
      amount: allocationAmount
    };
  }

  /**
   * Release funds when position is closed
   */
  releaseFunds(symbol: string): boolean {
    const reservation = this.reservations.get(symbol);
    if (!reservation) {
      console.warn(`⚠️ No reservation found for ${symbol}`);
      return false;
    }

    this.reservations.delete(symbol);
    console.log(`✅ Released $${reservation.reservedAmount.toFixed(2)} reservation for ${symbol}`);
    
    return true;
  }

  /**
   * Update reservation with order ID for tracking
   */
  updateReservation(symbol: string, orderId: string): void {
    const reservation = this.reservations.get(symbol);
    if (reservation) {
      reservation.orderId = orderId;
      console.log(`📝 Updated reservation for ${symbol} with order ID: ${orderId}`);
    }
  }

  /**
   * Get current allocation status
   */
  getAllocationStatus(): {
    totalBalance: number;
    totalReserved: number;
    availableBalance: number;
    reservations: AllocationReservation[];
    allocationPercentage: number;
  } {
    const reservationArray = Array.from(this.reservations.values());
    const totalReserved = reservationArray.reduce((sum, res) => sum + res.reservedAmount, 0);
    const availableBalance = this.totalBalance - totalReserved;
    const allocationPercentage = this.totalBalance > 0 ? (totalReserved / this.totalBalance) * 100 : 0;

    return {
      totalBalance: this.totalBalance,
      totalReserved,
      availableBalance,
      reservations: reservationArray,
      allocationPercentage
    };
  }

  /**
   * Get total account balance
   */
  get totalBalance(): number {
    return this.totalAccountBalance;
  }

  /**
   * Check if symbol has active reservation
   */
  hasReservation(symbol: string): boolean {
    return this.reservations.has(symbol);
  }

  /**
   * Get reservation amount for symbol
   */
  getReservation(symbol: string): number {
    const reservation = this.reservations.get(symbol);
    return reservation ? reservation.reservedAmount : 0;
  }

  /**
   * Force clear all reservations (emergency use)
   */
  clearAllReservations(): void {
    console.warn('🚨 Clearing all reservations (emergency)');
    this.reservations.clear();
  }

  /**
   * Clean up old reservations (older than 1 hour)
   */
  cleanupOldReservations(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [symbol, reservation] of this.reservations) {
      if (reservation.timestamp < oneHourAgo) {
        console.warn(`⚠️ Cleaning up old reservation for ${symbol} (${reservation.timestamp})`);
        this.reservations.delete(symbol);
      }
    }
  }
}

export default AllocationManager;