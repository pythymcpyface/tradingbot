import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { 
  BacktestConfig, 
  BacktestResult, 
  GlickoRating, 
  Kline 
} from '../../types';

export class RustCoreService {
  private initialized: boolean = false;
  private rustExecutablePath: string;

  constructor() {
    // In production (Docker), the binary is copied to dist/rust-core
    // In development, it's in src/rust-core/target
    if (process.env.NODE_ENV === 'production') {
      this.rustExecutablePath = path.join(__dirname, '../../rust-core/target/release/glicko-core');
    } else {
      this.rustExecutablePath = path.join(__dirname, '../../rust-core/target/release/glicko-core');
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<void> {
    try {
      // Check if binary already exists
      if (fs.existsSync(this.rustExecutablePath)) {
        console.log(`Rust binary found at ${this.rustExecutablePath}, skipping build`);
        this.initialized = true;
        return;
      }

      if (process.env.NODE_ENV === 'production') {
        console.warn(`Rust binary not found at ${this.rustExecutablePath} in production. Cannot build.`);
        this.initialized = true; // Use TS fallback
        return;
      }

      // Build Rust core if not already built (only in dev)
      await this.buildRustCore();
      this.initialized = true;
    } catch (error) {
      console.warn('Rust core unavailable, using TypeScript fallback implementation');
      this.initialized = true; // Still mark as initialized to use TypeScript implementation
    }
  }

  private async buildRustCore(): Promise<void> {
    return new Promise((resolve, reject) => {
      const rustCoreDir = path.join(__dirname, '../../rust-core');
      const buildProcess = spawn('cargo', ['build', '--release'], {
        cwd: rustCoreDir,
        stdio: 'pipe'
      });

      let stderr = '';

      buildProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Rust core built successfully');
          resolve();
        } else {
          console.error('Rust build failed:', stderr);
          reject(new Error(`Rust build failed with code ${code}: ${stderr}`));
        }
      });

      buildProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async calculateGlickoRatings(klines: Kline[]): Promise<GlickoRating[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const rustProcess = spawn(this.rustExecutablePath, ['calculate-glicko'], {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      // Send klines data to Rust process
      rustProcess.stdin.write(JSON.stringify(klines));
      rustProcess.stdin.end();

      rustProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      rustProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      rustProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const ratings = JSON.parse(stdout);
            resolve(ratings);
          } catch (parseError) {
            reject(new Error(`Failed to parse Rust output: ${parseError}`));
          }
        } else {
          reject(new Error(`Rust process failed with code ${code}: ${stderr}`));
        }
      });

      rustProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runBacktest(
    config: BacktestConfig, 
    ratings: GlickoRating[]
  ): Promise<BacktestResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const rustProcess = spawn(this.rustExecutablePath, ['run-backtest'], {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      // Send backtest config and ratings to Rust process
      const input = {
        config,
        ratings
      };
      
      rustProcess.stdin.write(JSON.stringify(input));
      rustProcess.stdin.end();

      rustProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      rustProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      rustProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse Rust output: ${parseError}`));
          }
        } else {
          reject(new Error(`Rust process failed with code ${code}: ${stderr}`));
        }
      });

      rustProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runWindowedBacktest(
    config: BacktestConfig, 
    ratings: GlickoRating[]
  ): Promise<BacktestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const rustProcess = spawn(this.rustExecutablePath, ['run-windowed-backtest'], {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      // Send backtest config and ratings to Rust process
      const input = {
        config,
        ratings
      };
      
      rustProcess.stdin.write(JSON.stringify(input));
      rustProcess.stdin.end();

      rustProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      rustProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      rustProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const results = JSON.parse(stdout);
            resolve(results);
          } catch (parseError) {
            reject(new Error(`Failed to parse Rust output: ${parseError}`));
          }
        } else {
          reject(new Error(`Rust process failed with code ${code}: ${stderr}`));
        }
      });

      rustProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async calculateZScores(
    ratings: GlickoRating[],
    movingAveragesPeriod: number
  ): Promise<Array<{
    symbol: string;
    timestamp: Date;
    zScore: number;
    signal: 'BUY' | 'SELL' | 'HOLD';
  }>> {
    // This would call a Rust function to calculate z-scores efficiently
    // For now, implementing in TypeScript as a placeholder
    
    const symbolRatings = new Map<string, Array<{ timestamp: Date; rating: number }>>();
    
    // Group ratings by symbol
    for (const rating of ratings) {
      if (!symbolRatings.has(rating.symbol)) {
        symbolRatings.set(rating.symbol, []);
      }
      symbolRatings.get(rating.symbol)!.push({
        timestamp: rating.timestamp,
        rating: rating.rating
      });
    }

    const results: Array<{
      symbol: string;
      timestamp: Date;
      zScore: number;
      signal: 'BUY' | 'SELL' | 'HOLD';
    }> = [];

    // Calculate z-scores for each symbol
    for (const [symbol, ratingHistory] of symbolRatings) {
      // Sort by timestamp
      ratingHistory.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      for (let i = movingAveragesPeriod; i < ratingHistory.length; i++) {
        const window = ratingHistory.slice(i - movingAveragesPeriod, i);
        const currentRating = ratingHistory[i].rating;
        
        const mean = window.reduce((sum, r) => sum + r.rating, 0) / window.length;
        const variance = window.reduce((sum, r) => sum + Math.pow(r.rating - mean, 2), 0) / window.length;
        const stdDev = Math.sqrt(variance);
        
        const zScore = stdDev > 0 ? (currentRating - mean) / stdDev : 0;
        
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        if (zScore > 2.0) signal = 'BUY';
        if (zScore < -2.0) signal = 'SELL';

        results.push({
          symbol,
          timestamp: ratingHistory[i].timestamp,
          zScore,
          signal
        });
      }
    }

    return results;
  }
}