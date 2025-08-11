use crate::{KlineData, GlickoRating, Result};
use crate::data::{HybridScore, MovingStats};
use std::collections::HashMap;

// Glicko-2 constants
const TAU: f64 = 0.5; // System constant (volatility change)
const EPSILON: f64 = 0.000001;
const GLICKO2_SCALE: f64 = 173.7178;
const DEFAULT_RATING: f64 = 1500.0;
const DEFAULT_RD: f64 = 350.0;
const DEFAULT_VOLATILITY: f64 = 0.06;

#[derive(Debug, Clone)]
pub struct GlickoPlayer {
    pub symbol: String,
    pub rating: f64,
    pub rating_deviation: f64,
    pub volatility: f64,
}

impl GlickoPlayer {
    pub fn new(symbol: String) -> Self {
        Self {
            symbol,
            rating: DEFAULT_RATING,
            rating_deviation: DEFAULT_RD,
            volatility: DEFAULT_VOLATILITY,
        }
    }

    pub fn to_glicko2_scale(&self) -> (f64, f64) {
        let mu = (self.rating - 1500.0) / GLICKO2_SCALE;
        let phi = self.rating_deviation / GLICKO2_SCALE;
        (mu, phi)
    }

    pub fn from_glicko2_scale(mu: f64, phi: f64, sigma: f64) -> (f64, f64, f64) {
        let rating = GLICKO2_SCALE * mu + 1500.0;
        let rd = GLICKO2_SCALE * phi;
        (rating, rd, sigma)
    }
}

// E(mu, mu_j, phi_j) function from Glicko-2 spec
fn e_function(mu: f64, mu_j: f64, g_phi_j: f64) -> f64 {
    1.0 / (1.0 + (-g_phi_j * (mu - mu_j)).exp())
}

// g(phi) function from Glicko-2 spec
fn g_function(phi: f64) -> f64 {
    1.0 / (1.0 + 3.0 * phi.powi(2) / std::f64::consts::PI.powi(2)).sqrt()
}

// f(x) function for volatility calculation
fn f_function(x: f64, delta_squared: f64, phi_squared: f64, v: f64, a: f64, tau_squared: f64) -> f64 {
    let ex = x.exp();
    let num = ex * (delta_squared - phi_squared - v - ex);
    let den = 2.0 * (phi_squared + v + ex).powi(2);
    num / den - (x - a) / tau_squared
}

// Illinois algorithm for finding new volatility
fn find_new_volatility(
    sigma: f64,
    delta: f64,
    phi: f64,
    v: f64,
) -> f64 {
    let a = (sigma.powi(2)).ln();
    let tau_squared = TAU.powi(2);
    let delta_squared = delta.powi(2);
    let phi_squared = phi.powi(2);

    // Initial bounds
    let mut big_a = a;
    let mut big_b = if delta_squared > phi_squared + v {
        (delta_squared - phi_squared - v).ln()
    } else {
        let mut k = 1.0;
        while f_function(a - k * TAU, delta_squared, phi_squared, v, a, tau_squared) < 0.0 {
            k += 1.0;
        }
        a - k * TAU
    };

    let mut f_a = f_function(big_a, delta_squared, phi_squared, v, a, tau_squared);
    let mut f_b = f_function(big_b, delta_squared, phi_squared, v, a, tau_squared);

    // Illinois algorithm
    for _ in 0..50 {
        let big_c = big_a + (big_a - big_b) * f_a / (f_b - f_a);
        let f_c = f_function(big_c, delta_squared, phi_squared, v, a, tau_squared);

        if f_c.abs() < EPSILON {
            return (big_c / 2.0).exp();
        }

        if f_c * f_b < 0.0 {
            big_a = big_b;
            f_a = f_b;
        } else {
            f_a /= 2.0;
        }

        big_b = big_c;
        f_b = f_c;
    }

    (big_a / 2.0).exp()
}

pub fn update_rating(
    player: &GlickoPlayer,
    opponent_rating: f64,
    opponent_rd: f64,
    score: f64,
) -> GlickoPlayer {
    // Convert to Glicko-2 scale
    let (mu, phi) = player.to_glicko2_scale();
    let (mu_j, phi_j) = {
        let temp_player = GlickoPlayer {
            symbol: "opponent".to_string(),
            rating: opponent_rating,
            rating_deviation: opponent_rd,
            volatility: 0.06,
        };
        temp_player.to_glicko2_scale()
    };

    let g_phi_j = g_function(phi_j);
    let e_mu_mu_j = e_function(mu, mu_j, g_phi_j);

    // Step 1: Compute estimated variance
    let v = 1.0 / (g_phi_j.powi(2) * e_mu_mu_j * (1.0 - e_mu_mu_j));

    // Step 2: Compute estimated improvement
    let delta = v * g_phi_j * (score - e_mu_mu_j);

    // Step 3: Compute new volatility
    let new_volatility = find_new_volatility(player.volatility, delta, phi, v);

    // Step 4: Update rating and RD
    let phi_star = (phi.powi(2) + new_volatility.powi(2)).sqrt();
    let new_phi = 1.0 / (1.0 / phi_star.powi(2) + 1.0 / v).sqrt();
    let new_mu = mu + new_phi.powi(2) * g_phi_j * (score - e_mu_mu_j);

    // Convert back to original scale
    let (new_rating, new_rd, final_volatility) = 
        GlickoPlayer::from_glicko2_scale(new_mu, new_phi, new_volatility);

    GlickoPlayer {
        symbol: player.symbol.clone(),
        rating: new_rating,
        rating_deviation: new_rd,
        volatility: final_volatility,
    }
}

pub fn calculate_ratings(mut klines: Vec<KlineData>) -> Result<Vec<GlickoRating>> {
    // Sort klines by timestamp
    klines.sort_by_key(|k| k.open_time);

    let mut players: HashMap<String, GlickoPlayer> = HashMap::new();
    let mut ratings: Vec<GlickoRating> = Vec::new();

    // Benchmark opponent (USDT baseline)
    let benchmark_rating = 1500.0;
    let benchmark_rd = 50.0;

    for kline in klines {
        // Get or create player
        let player = players
            .entry(kline.symbol.clone())
            .or_insert_with(|| GlickoPlayer::new(kline.symbol.clone()));

        // Calculate hybrid performance score
        let taker_sell_volume = kline.volume - kline.taker_buy_base_asset_volume;
        let hybrid_score = HybridScore::calculate(
            kline.open,
            kline.close,
            kline.taker_buy_base_asset_volume,
            taker_sell_volume,
        );

        // Update player rating
        let updated_player = update_rating(
            player,
            benchmark_rating,
            benchmark_rd,
            hybrid_score.score,
        );

        // Store the updated player
        *player = updated_player.clone();

        // Create rating record
        let rating_record = GlickoRating {
            symbol: kline.symbol,
            timestamp: kline.open_time,
            rating: updated_player.rating,
            rating_deviation: updated_player.rating_deviation,
            volatility: updated_player.volatility,
            performance_score: hybrid_score.score,
        };

        ratings.push(rating_record);
    }

    Ok(ratings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glicko_player_creation() {
        let player = GlickoPlayer::new("BTC".to_string());
        assert_eq!(player.symbol, "BTC");
        assert_eq!(player.rating, DEFAULT_RATING);
        assert_eq!(player.rating_deviation, DEFAULT_RD);
        assert_eq!(player.volatility, DEFAULT_VOLATILITY);
    }

    #[test]
    fn test_scale_conversion() {
        let player = GlickoPlayer::new("BTC".to_string());
        let (mu, phi) = player.to_glicko2_scale();
        let (rating, rd, sigma) = GlickoPlayer::from_glicko2_scale(mu, phi, player.volatility);
        
        assert!((rating - DEFAULT_RATING).abs() < 1e-6);
        assert!((rd - DEFAULT_RD).abs() < 1e-6);
        assert!((sigma - DEFAULT_VOLATILITY).abs() < 1e-6);
    }

    #[test]
    fn test_rating_update_win() {
        let player = GlickoPlayer::new("BTC".to_string());
        let updated = update_rating(&player, 1500.0, 200.0, 1.0);
        
        // After a win, rating should increase
        assert!(updated.rating > player.rating);
        // RD should decrease (more certain)
        assert!(updated.rating_deviation < player.rating_deviation);
    }

    #[test]
    fn test_rating_update_loss() {
        let player = GlickoPlayer::new("BTC".to_string());
        let updated = update_rating(&player, 1500.0, 200.0, 0.0);
        
        // After a loss, rating should decrease
        assert!(updated.rating < player.rating);
        // RD should decrease (more certain)
        assert!(updated.rating_deviation < player.rating_deviation);
    }

    #[test]
    fn test_g_function() {
        let phi = 0.1;
        let g = g_function(phi);
        assert!(g > 0.0 && g <= 1.0);
    }

    #[test]
    fn test_e_function() {
        let mu = 0.0;
        let mu_j = 0.0;
        let g_phi_j = 1.0;
        let e = e_function(mu, mu_j, g_phi_j);
        assert!((e - 0.5).abs() < 1e-6); // Should be 0.5 for equal ratings
    }

    #[test]
    fn test_calculate_ratings_empty() {
        let klines = vec![];
        let result = calculate_ratings(klines);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_calculate_ratings_single_kline() {
        let klines = vec![KlineData {
            symbol: "BTCUSDT".to_string(),
            open_time: 1640995200000, // 2022-01-01
            close_time: 1640998800000,
            open: 47000.0,
            high: 48000.0,
            low: 46500.0,
            close: 47500.0, // Price up
            volume: 100.0,
            quote_asset_volume: 4750000.0,
            number_of_trades: 1000,
            taker_buy_base_asset_volume: 60.0, // More buying
            taker_buy_quote_asset_volume: 2850000.0,
        }];

        let result = calculate_ratings(klines);
        assert!(result.is_ok());
        
        let ratings = result.unwrap();
        assert_eq!(ratings.len(), 1);
        
        let rating = &ratings[0];
        assert_eq!(rating.symbol, "BTCUSDT");
        assert!(rating.rating > DEFAULT_RATING); // Should increase due to good performance
        assert_eq!(rating.performance_score, 1.0); // High-confidence win
    }
}