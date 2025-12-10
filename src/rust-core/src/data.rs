use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridScore {
    pub price_up: bool,
    pub price_unchanged: bool,
    pub taker_buy_dominant: bool,
    pub score: f64,
    pub confidence: ScoreConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScoreConfidence {
    High,
    Low,
    Neutral,
}

impl HybridScore {
    pub fn calculate(
        open: f64,
        close: f64,
        taker_buy_volume: f64,
        taker_sell_volume: f64,
    ) -> Self {
        // Calculate price change for continuous scaling (matches live engine algorithm)
        let price_change = (close - open) / open;

        // Continuous scaling: gameResult = 0.5 + (priceChange * 50)
        // Maps to [0.0, 1.0] where 0.5 is neutral (0% change)
        let score = if (price_change).abs() < 0.001 {
            // Draw: < 0.1% change
            0.5
        } else {
            // Continuous scaling bounded to [0.0, 1.0]
            (0.5 + price_change * 50.0).max(0.0).min(1.0)
        };

        // Determine price direction and dominance for metadata
        let price_up = close > open;
        let price_unchanged = (close - open).abs() < 0.001; // < 0.1% change threshold
        let taker_buy_dominant = taker_buy_volume > taker_sell_volume;

        // Assign confidence level based on game result magnitude
        let confidence = if (score - 0.5).abs() < 0.1 {
            ScoreConfidence::Neutral  // Close to 0.5 (draw)
        } else if (score - 0.5).abs() < 0.25 {
            ScoreConfidence::Low      // Low-confidence move (0.25-0.75 range)
        } else {
            ScoreConfidence::High     // High-confidence move (0.0-0.25 or 0.75-1.0)
        };

        Self {
            price_up,
            price_unchanged,
            taker_buy_dominant,
            score,
            confidence,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MovingStats {
    pub mean: f64,
    pub std_dev: f64,
    pub z_score: f64,
}

impl MovingStats {
    pub fn calculate(values: &[f64], current_value: f64) -> Self {
        if values.is_empty() {
            return Self {
                mean: current_value,
                std_dev: 0.0,
                z_score: 0.0,
            };
        }

        let mean = values.iter().sum::<f64>() / values.len() as f64;
        
        let variance = values
            .iter()
            .map(|x| (x - mean).powi(2))
            .sum::<f64>() / values.len() as f64;
        
        let std_dev = variance.sqrt();
        
        let z_score = if std_dev > 0.0 {
            (current_value - mean) / std_dev
        } else {
            0.0
        };

        Self {
            mean,
            std_dev,
            z_score,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hybrid_score_high_confidence_win() {
        let score = HybridScore::calculate(100.0, 105.0, 1000.0, 500.0);
        assert_eq!(score.score, 1.0);
        assert!(matches!(score.confidence, ScoreConfidence::High));
        assert!(score.price_up);
        assert!(score.taker_buy_dominant);
    }

    #[test]
    fn test_hybrid_score_low_confidence_win() {
        let score = HybridScore::calculate(100.0, 105.0, 500.0, 1000.0);
        assert_eq!(score.score, 0.75);
        assert!(matches!(score.confidence, ScoreConfidence::Low));
        assert!(score.price_up);
        assert!(!score.taker_buy_dominant);
    }

    #[test]
    fn test_hybrid_score_draw() {
        let score = HybridScore::calculate(100.0, 100.0, 500.0, 1000.0);
        assert_eq!(score.score, 0.5);
        assert!(matches!(score.confidence, ScoreConfidence::Neutral));
        assert!(score.price_unchanged);
    }

    #[test]
    fn test_moving_stats() {
        let values = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let stats = MovingStats::calculate(&values, 6.0);
        
        assert!((stats.mean - 3.0).abs() < 1e-6);
        assert!(stats.std_dev > 0.0);
        assert!(stats.z_score > 0.0);
    }
}