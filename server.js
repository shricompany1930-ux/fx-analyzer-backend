import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   HELPER FUNCTIONS
========================= */

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
  if (pair === "EURUSD") return "EUR/USD";
  if (pair === "GBPUSD") return "GBP/USD";
  return pair;
}

// London + NY session filter (UTC)
function isLondonOrNYSession() {
  const h = new Date().getUTCHours();
  return (h >= 7 && h <= 16) || (h >= 12 && h <= 21);
}

// CPI / NFP filter (13:00–14:00 UTC)
function isHighImpactNewsTime() {
  const d = new Date();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return h === 13 || (h === 14 && m === 0);
}

// Telegram
async function sendTelegram(message) {
  const token = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });
}

/* =========================
   ANALYZE ROUTE
========================= */

app.post("/analyze", async (req, res) => {
  try {
    const { pair, timeframe } = req.body;

    if (!process.env.TWELVE_DATA_API_KEY) {
      return res.json({ status: "ERROR", reason: "API key missing" });
    }

    if (!isLondonOrNYSession()) {
      return res.json({
        status: "NO TRADE",
        reason: "Outside London & New York session"
      });
    }

    if (isHighImpactNewsTime()) {
      return res.json({
        status: "NO TRADE",
        reason: "High impact news (CPI / NFP)"
      });
    }

    const symbol = mapSymbol(pair);
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${timeframe}&outputsize=100&apikey=${process.env.TWELVE_DATA_API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();
    if (!data.values) {
      return res.json({ status: "ERROR", reason: data.message });
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
    } else if (ema20 > ema50 && rsi >= 40 && rsi <= 55 && last.close > last.open) {
      status = "VALID";
      bias = "BUY";
    } else if (ema20 < ema50 && rsi >= 45 && rsi <= 60 && last.close < last.open) {
      status = "VALID";
      bias = "SELL";
    }

    let entry = null, sl = null, tp = null, expiryTime = null;
    const expiryMinutes = timeframe === "5min" ? 5 : timeframe === "15min" ? 15 : 60;

    if (status === "VALID") {
      entry = Number(last.close);
      const rr = timeframe === "5min" ? 1.2 : 1.5;

      if (bias === "BUY") {
        sl = Number(last.low);
        tp = entry + (entry - sl) * rr;
      } else {
        sl = Number(last.high);
        tp = entry - (sl - entry) * rr;
      }

      expiryTime = new Date(Date.now() + expiryMinutes * 60000).toISOString();

      await sendTelegram(
`📊 ${pair} | ${timeframe}
${bias === "BUY" ? "🟢 BUY" : "🔴 SELL"}

Entry: ${entry}
SL: ${sl}
TP: ${tp}

⏳ Valid ${expiryMinutes} min
RSI: ${rsi.toFixed(2)}`
      );
    }

    res.json({
      status, bias, entry, sl, tp, expiryTime,
      ema20, ema50, rsi
    });

  } catch (e) {
    res.json({ status: "ERROR", reason: e.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Analyzer running")
);
