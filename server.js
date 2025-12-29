import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = "YOUR_TWELVEDATA_API_KEY";

function EMA(values, period) {
  const k = 2 / (period + 1);
  let ema = values[0];
  return values.map(v => (ema = v * k + ema * (1 - k)));
}

function RSI(values, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    diff >= 0 ? (gains += diff) : (losses -= diff);
  }
  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
}

app.post("/analyze", async (req, res) => {
  const { pair, timeframe } = req.body;

  const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=${timeframe}&outputsize=100&apikey=${API_KEY}`;
  const r = await fetch(url);
  const data = await r.json();

  const candles = data.values.reverse();
  const closes = candles.map(c => parseFloat(c.close));

  const ema20 = EMA(closes, 20).at(-1);
  const ema50 = EMA(closes, 50).at(-1);
  const rsi = RSI(closes);

  const last = candles.at(-1);
  let result = { status: "WAIT", reason: "" };

  if (Math.abs(ema20 - ema50) < 0.0001) {
    result = { status: "NO TRADE", reason: "EMA flat" };
  } else if (ema20 > ema50 && rsi >= 40 && rsi <= 55 && last.close > last.open) {
    result = { status: "VALID", bias: "BUY" };
  } else if (ema20 < ema50 && rsi >= 45 && rsi <= 60 && last.close < last.open) {
    result = { status: "VALID", bias: "SELL" };
  }

  res.json({
    ...result,
    ema20,
    ema50,
    rsi,
    candleTime: last.datetime
  });
});

app.listen(3000, () => console.log("Analyzer running on port 3000"));
