# **Specification**

## **Intro**

This document lists the requirements and their importance for the project.  
Priority levels:

* High: Requirements listed as priority level "High" must be fulfilled by the project  
* Medium: Requirements listed as priority level "Medium" should be fulfilled by the project unless they cause conflicts with other requirements or are difficult to implement with the given technology.  
* Low: Requirements listed as priority level "Low" do not need to be fulfilled by the project but would be useful to have.  
1. **Trading**:  
* High: Must use the Binance api using the API\_KEY and API\_SECRET in the .env file in the project  
* High: Must automatically buy/sell a coin when the strategy signals to do so  
  * High: Must contain a strategy which calculates the **Glicko-2 rating** of each coin for a given time range.  
    * High: Must calculate the Glicko-2 rating by using a **hybrid performance score** derived from price action and taker volume dominance, as defined in the Glicko-2 Spec.  
      * High: Must download the open, close, and taker volume data for each coin for a given time range.  
      * High: Must calculate the hybrid performance score for each coin for each 1-hour interval.  
      * High: Must calculate the Glicko-2 rating (μ), deviation (φ), and volatility (σ) and average the rating over a given time range (glicko\_moving\_averages).  
      * High: Must download and calculate quicker than the given time range.  
      * High: Must only download data for pairs which are trading and both coins are in the coins environment variable in .env.  
      * High: Must send a buy request for a coin when its Glicko-2 rating **z-score** is above a specified threshold (e.g., \+3.0).  
      * High: Must send a sell request for a held coin when its Glicko-2 rating **z-score** is below the negative of the entry threshold (e.g., \-3.0).  
      * High: Must send a sell request for a held coin if its % profit is above a specified value (profit\_percent).  
      * High: Must send a sell request for a held coin if its % loss is above a specified value (stop\_loss\_percent).  
  * Medium: Should contain other strategies commonly used in trading e.g. RSI, MACD, Bollinger bands.  
  * Medium: Should be able to combine strategies to maximize returns.  
2. **Optimisation**:  
* High: Must download klines for all trading pairs given a list of coins in the .env and save the klines appropriately in a klines table.  
* High: Must calculate **Glicko-2 ratings (μ, φ, σ)** for every unique timestamp in the klines table and save them in a glicko\_ratings table.  
* High: Must create a script which runs a backtest on the entire date range of data in the glicko\_ratings table according to the BACKTEST\_SPEC.md. The script should take the following arguments: baseAsset, quoteAsset, z\_score\_threshold, moving\_averages, profit\_percent, stop\_loss\_percent. The script must create the chart and table as defined in the BACKTEST\_SPEC.md and upload the backtest orders and optimisation results to the database. The only file it should save is the .html file.  
* High: Must create a script which then runs the entire set of parameters given in the expected values in the BACKTEST\_SPEC.md. It should take the following arguments: baseAsset, quoteAsset. It should use the aforementioned backtest script. Once all backtests are completed it should then create an analysis report .html file of the best strategies and also create a multivariate analysis of the parameters to investigate correlations for best return as defined in the BACKTEST\_SPEC.md.  
* High: Must optimise the Glicko-2 strategy to give the biggest profit.  
  * High: Must optimise the parameters defined in BACKTEST\_SPEC.md.  
    * High: Must download a long time range's worth of data (**4 years**), save it to a database, then:  
      * High: Must calculate the Glicko-2 rating across the entire time range.  
      * High: Must average the Glicko-2 rating over a range of intervals (glicko\_moving\_averages).  
      * High: Must fulfill the specification defined in BACKTEST\_SPEC.md, including the **windowed backtesting methodology**.  
  * Medium: Should carry out an analysis of average change in price before and after each trade for each set of parameters.  
  * Medium: Should use a large range of parameters.  
  * Medium: Should run optimisation in parallel to increase efficiency.  
  * Medium: Should be able to carry out a multivariate regression analysis of the parameters to give a final optimisation.  
  * Medium: Should not take longer than 7 hours to complete all backtests.  
3. **Database**:  
* High: Must download klines for all trading pairs given a list of coins in the .env and save the klines appropriately in a klines table.  
* High: Must calculate **Glicko-2 ratings** for every unique timestamp in the klines table and save each coin's Glicko-2 rating (μ), deviation (φ), and volatility (σ) in a **glicko\_ratings** table.  
* High: Must save production order information to an order table with all fields supplied by the Binance api.  
* High: Must update the production order table as necessary, for example after an oco order has executed and the sell order part needs to be set to filled.  
* High: Must save backtest order information to a backtest\_order table.  
* High: Must save parameters and their return values in an optimisation table.  
* High: Database must be prisma with postgres.  
* High: Database must persist data.  
* Medium: Users should be able to send api requests to the database to get data.  
4. **Tests**:  
* High: Must contain unit tests with 70% code coverage.  
* High: Must cover a range of edge cases including if arguments are undefined or null.  
* High: Must cover UI.  
* High: Must be a test for the **Glicko-2 calculation** that verifies the correct implementation of the algorithm against a known set of inputs and outcomes.  
* High: Must be a test for the **Glicko-2 data** that verifies that ratings, deviations, and volatilities update in expected ways (e.g., deviation decreases after a match).  
* High: Must be a test that verifies that there is a valid baseAsset/quoteAsset price datapoint in the klines table for each timestamp in the **glicko\_ratings** table.  
* High: Must be a test that verifies there are exactly the correct number of datapoints in the **glicko\_ratings** table for the given date range and interval time.  
* High: Must verify that there are trades in the backtest.  
* High: For large date range scripts, verify that the script works for a much shorter date range first, then continue to the full date range if it works.  
* Medium: Should be saved in the test directory.  
5. **Backend**:  
* Should be written in Typescript.  
6. **Frontend**:  
* High: Must display the production order history data when given an API\_KEY and API\_SECRET.  
* High: Must display the backtest order history data.  
* High: Must display the optimisation parameters data.  
* High: Must display the user's returns in a chart:  
  * High: Must have configurable start time.  
  * High: Must have filter settings for pair.  
  * High: Must live update with the user's current value in USDT second by second for example if the user has recently bought ETH it will show the current value in USDT.  
  * High: Must show the user's current profit and profit percent based on the start time.  
  * High: Must show the user's annualised return based on current profit value.  
* High: Must show the backtest order history in a chart.  
  * High: Must overlay market performance.  
  * High: Should display corresponding backtest analysis calculations with the chart, including: **Alpha, Sharpe Ratio, Sortino Ratio, Win Ratio, Max Drawdown, Annualized Return, and Total Return**.  
  * Medium: Should show where each trade was.  
  * Medium: Should show whether there was a gain or a loss for each trade.  
* Medium: Should show the multivariate regression analysis for parameters in a chart.  
* Medium: Should show charts displaying average change in price before and after each trade for each coin with given parameters.

## **Stages**

The following stages must be followed in order while creating the application:

1. **Initialisation**  
* Initialize Git repository.  
* Set up TypeScript, ESLint, Jest configuration.  
* Create project directory structure.  
* Set up Prisma database schema: klines, **glicko\_ratings**, production\_orders, backtest\_orders, optimizations.  
* Create Docker configuration.  
2. **Database & API Foundation**  
* Set up PostgreSQL with Prisma.  
* Create database tables: klines, **glicko\_ratings**, orders, backtest\_orders, optimizations.  
* Build basic API endpoints: /api/backtest, /api/orders, /api/optimisation.  
* Create TypeScript types for all data models.  
3. **Core Trading Logic**  
* Implement **Glicko-2 rating** calculation system:  
  1. Create a script called getTradingPairs.ts which takes an argument 'coins' and calculates which trading pairs from binance exist where each coin in the pair is one of the coins in the argument.  
  2. Run the getTradingPairs script on the coins in the .env and output the trading pairs.  
  3. Create a script called getKlines.ts which downloads the klines from the Binance API for a set of trading pairs given that interval is 1hr, and saves the data in the klines table. Arguments: tradingPairs, startTime, endTime.  
  4. Run the getKlines script where tradingPairs \= the output of getTradingPairs, startTime \= today \- **4 years ago**, endTime \= today.  
  5. Create a script called **calculateGlickoRatings.ts** which implements the hybrid performance score and Glicko-2 system, uploading the ratings (μ, φ, σ) for each coin to the **glicko\_ratings** table. Arguments: coins, startTime, endTime.  
  6. Create a unit test for the **calculateGlickoRatings.ts** script with mock data which proves the algorithm is implemented correctly.  
  7. Run the **calculateGlickoRatings.ts** on the entire klines table data given coins \= list of coins from .env, startTime \= earliest timestamp in klines table, endTime \= latest timestamp in klines table.  
  8. Run a test on the data in the **glicko\_ratings** table to verify expected behavior (e.g., RD decreases after activity).  
  9. Create a script called **plotGlickoRatings.ts** which plots all Glicko-2 ratings from the **glicko\_ratings** table on a chart, including the rating deviation as an uncertainty band. Outputs a single .html file and saves in the analysis directory.  
  10. Run the **plotGlickoRatings.ts** on the entire **glicko\_ratings** table data.  
* Build Binance API integration (live trading).  
* Create risk management (stop-loss, profit targets).  
* Implement automated trading logic based on the z-score signals.  
4. **Backtesting Engine**  
* Build historical data analysis system:  
  1. Clear the backtest orders table and optimization table and .html files in the analysis directory before starting this stage.  
  2. Create a script called runWindowedBacktest.ts which runs a backtest on a windowSize (in months) of data according to the BACKTEST\_SPEC.md. The script should take the following arguments: startTime, windowSize, baseAsset, quoteAsset, zScoreThreshold, movingAverages, profitPercent, stopLossPercent. It must create the chart and table as defined in the BACKTEST\_SPEC.md and upload results to the database.  
  3. Then create a script called runAllWindowedBacktests.ts which executes the runWindowedBacktest.ts script iteratively. It must implement the **walk-forward methodology**: start at startTime, run the backtest for windowSize months, then step forward by windowSize / 2 months and repeat until the end of the dataset. The script should then create a chart overlaying each backtest's equity curve.  
  4. Run the runAllWindowedBacktests script with startTime \= earliest date in database, windowSize \= 12, baseAsset \= ETH, quoteAsset \= USDT, zScoreThreshold \= 3.0, movingAverages \= 200, profitPercent \= \+5.0%, stopLossPercent \= \-2.5%.  
  5. Run a test on the data in the backtest orders and optimization tables to verify: The backtest ran correctly, trades exist, and all statistics (**Alpha, Sharpe, Sortino, drawdown, win ratio, etc.**) were calculated correctly.  
  6. Create a script called runAllWindowedBacktestsForPair.ts which then runs the entire set of parameters given in the expected values in the BACKTEST\_SPEC.md using the windowed methodology. Once all backtests are completed it should then create an analysis report .html file of the best strategies and also create a multivariate analysis of the parameters to investigate correlations for best return as defined in the BACKTEST\_SPEC.md.  
  7. Run the runAllWindowedBacktestsForPair script given baseAsset \= ETH, quoteAsset \= USDT.  
  8. Run the runAllWindowedBacktestsForPair script on all remaining coins in the .env.  
5. **Frontend Dashboard**  
* Create React components for production dashboard.  
* Build backtest visualization interface.  
* Implement real-time updates for live trading.  
* Add responsive design for mobile access.  
6. **Testing & Deployment**  
* Achieve 70% test coverage.  
* Set up automated CI/CD pipeline.  
* Create documentation and deployment guides.