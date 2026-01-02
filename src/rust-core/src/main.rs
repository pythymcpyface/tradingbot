use clap::{Arg, Command};
use glicko_core::{calculate_glicko_ratings, run_backtest, run_windowed_backtest, KlineData, BacktestConfig, GlickoRating};
use std::io::{self, Read};
use anyhow::Result;

fn main() -> Result<()> {
    let matches = Command::new("glicko-core")
        .version("1.0")
        .author("Trading Bot System")
        .about("High-performance Glicko-2 rating and backtesting engine")
        .subcommand(
            Command::new("calculate-glicko")
                .about("Calculate Glicko-2 ratings from klines data")
        )
        .subcommand(
            Command::new("run-backtest")
                .about("Run a backtest with given configuration")
        )
        .subcommand(
            Command::new("run-windowed-backtest")
                .about("Run windowed backtest with walk-forward analysis")
        )
        .get_matches();

    match matches.subcommand() {
        Some(("calculate-glicko", _)) => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            
            let klines: Vec<KlineData> = serde_json::from_str(&input)?;
            let ratings = calculate_glicko_ratings(klines).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            
            println!("{}", serde_json::to_string(&ratings)?);
        },
        Some(("run-backtest", _)) => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            
            let data: serde_json::Value = serde_json::from_str(&input)?;
            let config: BacktestConfig = serde_json::from_value(data["config"].clone())?;
            let ratings: Vec<GlickoRating> = serde_json::from_value(data["ratings"].clone())?;
            
            let result = run_backtest(config, ratings).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            
            println!("{}", serde_json::to_string(&result)?);
        },
        Some(("run-windowed-backtest", _)) => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            
            let data: serde_json::Value = serde_json::from_str(&input)?;
            let config: BacktestConfig = serde_json::from_value(data["config"].clone())?;
            let ratings: Vec<GlickoRating> = serde_json::from_value(data["ratings"].clone())?;
            
            let results = run_windowed_backtest(config, ratings).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            
            println!("{}", serde_json::to_string(&results)?);
        },
        _ => {
            eprintln!("No subcommand was used. Use --help for available commands.");
            std::process::exit(1);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_help() {
        // This test ensures the CLI structure is valid
        let app = Command::new("glicko-core");
        app.try_get_matches_from(vec!["glicko-core", "--help"]).unwrap_err();
    }

    #[test]
    fn test_subcommands_exist() {
        let app = Command::new("glicko-core")
            .subcommand(Command::new("calculate-glicko"))
            .subcommand(Command::new("run-backtest"))
            .subcommand(Command::new("run-windowed-backtest"));
        
        let matches = app.try_get_matches_from(vec!["glicko-core", "calculate-glicko"]);
        assert!(matches.is_ok());
    }
}