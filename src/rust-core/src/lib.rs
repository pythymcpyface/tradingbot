pub mod glicko;
pub mod backtest;
pub mod data;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KlineData {
    pub symbol: String,
    pub open_time: i64,
    pub close_time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub quote_asset_volume: f64,
    pub number_of_trades: u32,
    pub taker_buy_base_asset_volume: f64,
    pub taker_buy_quote_asset_volume: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlickoRating {
    pub symbol: String,
    pub timestamp: i64,
    pub rating: f64,
    pub rating_deviation: f64,
    pub volatility: f64,
    pub performance_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestConfig {
    pub base_asset: String,
    pub quote_asset: String,
    pub z_score_threshold: f64,
    pub moving_averages: usize,
    pub profit_percent: f64,
    pub stop_loss_percent: f64,
    pub start_time: i64,
    pub end_time: i64,
    pub window_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestResult {
    pub total_return: f64,
    pub annualized_return: f64,
    pub sharpe_ratio: f64,
    pub sortino_ratio: f64,
    pub alpha: f64,
    pub max_drawdown: f64,
    pub win_ratio: f64,
    pub total_trades: usize,
    pub profit_factor: f64,
    pub avg_trade_duration: f64,
    pub orders: Vec<BacktestOrder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestOrder {
    pub symbol: String,
    pub side: String,
    pub quantity: f64,
    pub price: f64,
    pub timestamp: i64,
    pub reason: String,
    pub profit_loss: Option<f64>,
    pub profit_loss_percent: Option<f64>,
}

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub fn calculate_glicko_ratings(klines: Vec<KlineData>) -> Result<Vec<GlickoRating>> {
    glicko::calculate_ratings(klines)
}

pub fn run_backtest(config: BacktestConfig, ratings: Vec<GlickoRating>) -> Result<BacktestResult> {
    backtest::run_backtest(config, ratings)
}

pub fn run_windowed_backtest(
    config: BacktestConfig, 
    ratings: Vec<GlickoRating>
) -> Result<Vec<BacktestResult>> {
    backtest::run_windowed_backtest(config, ratings)
}