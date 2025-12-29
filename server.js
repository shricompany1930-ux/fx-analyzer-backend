import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// --- Helpers ---
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

function mapSymbol(pair) {
  if (pair === "XAUUSD") return "XAU/USD";
  return pair;
}

// --- Route ---
app.post("/analyze", async (req, res) => {
  try {
    const { pair, timeframe } = req.body;

    const API_KEY = process.env.TWELVE_DATA_API_KEY;
    if (!API_KEY) {
      return res.json({ status: "ERROR", reason: "API key missing" });
    }

    const symbol = mapSymbol(pair);
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${timeframe}&outputsize=100&apikey=${API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!data.values) {
      return res.json({
        status: "ERROR",
        reason: data.message || "No data returned from API"
      });
    }

    const candles = data.values.reverse();
    const closes = candles.map(c => Number(c.close));

    const ema20 = EMA(closes, 20).at(-1);
    const ema50 = EMA(closes, 50).at(-1);
    const rsi = RSI(closes);

    const last = candles.at(-1);

    let status = "WAIT";
    let bias = "NONE";

    if (Math.abs(ema20 - ema50) < 0.00001) {
      status = "NO TRADE";
    } 
    else if (ema20 > ema50 && rsi >= 40 && rsi <= 55 && last.close > last.open) {
      status = "VALID";
      bias = "BUY";
    } 
    else if (ema20 < ema50 && rsi >= 45 && rsi <= 60 && last.close < last.open) {
      status = "VALID";
      bias = "SELL";
    }

    return res.json({
      status,
      bias,
      ema20,
      ema50,
      rsi,
      candleTime: last.datetime
    });

  } catch (err) {
    console.error("Analyze error:", err);
    return res.json({ status: "ERROR", reason: err.message });
  }
});

// --- Port (Render-safe) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Analyzer running on port ${PORT}`);
});
