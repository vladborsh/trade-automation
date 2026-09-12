### Command for backtesting:

Use real-data from exchange:

```bash
npm run backtest 2024-10-15 2024-10-16 m1 BTCUSDT sm

# 'sm' - smart money strategy
# 'ta' - tech analysis strategy

```

Use data from static source:

```bash
npm run backtest 2024-11-01 2024-11-15 m1 BTCUSDT sm data/BTCUSDT-data.json
```

- Make sure to have static source file in the root of the project or specify path to it.
- Make sure static source has data for the backtested period.
- Static source emulate exchange objects. Despite of it accepts symbols as strings, it will always return candles from collected data file.

### Command for scrapping data:

```bash
npm run scrap 2024-11-01 2024-11-15 m1 BTCUSDT 
```

### Debugging:

For debugging and monitoring scrapped data you can use chart visualizer. You can build project with chart visualizer:

```bash
npm run chart-visualizer
```

Then run static server with index.html file from chart visualizer folder.

In browser window you can put file with scrapped data and chart visualizer will show it.


### Shortcuts:

```bash
npm run scrap 2024-2-1 2024-11-1 m1 BTCUSDT
npm run scrap 2024-2-1 2024-11-1 m1 ETHUSDT
npm run scrap 2024-2-1 2024-11-1 m1 US500 true

npm run backtest 2024-2-1 2024-10-20 m1 BTCUSDT sm ./data/BTCUSDT-2024-02-01-2024-11-01-m1.json,./data/BTCUSDT-2024-01-01-2024-11-01-h1.json

npm run backtest 2024-2-1 2024-10-20 m1 ETHUSDT sm ./data/ETHUSDT-2024-01-01-2024-11-01-m1.json,./data/ETHUSDT-2024-01-01-2024-11-01-h1.json

npm run backtest 2024-2-1 2024-11-1 m1 US100 vwap ./data/US100-2024-02-01-2024-11-01-m1.json

npm run backtest 2024-2-1 2024-11-1 m1 US500 vwap ./data/US500-2024-02-01-2024-11-01-m1.json
```
