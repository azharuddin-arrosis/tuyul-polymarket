const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

const SCANNER_CONFIG = {
  MIN_LIQUIDITY: 10_000,
  MIN_VOLUME_24H: 5_000,
  MAX_SPREAD: 0.05,
  MAX_DAYS_TO_RESOLVE: 60,
  PRICE_RANGE: { min: 0.05, max: 0.95 },
  FETCH_LIMIT: 50,
};

const TRADING_CONFIG = {
  MIN_EDGE: 0.10,
  MAX_POSITION_SIZE: 100,
  KELLY_FRACTION: 0.25,
};

let marketCache = { lastUpdate: null, data: [] };
let positions = [];
let walletBalance = 1000;

async function fetchActiveMarkets() {
  const params = new URLSearchParams({
    active: "true",
    limit: SCANNER_CONFIG.FETCH_LIMIT,
    order: "volume_24hr",
    ascending: "false",
    enable_order_book: "true",
  });

  const url = `${GAMMA_API}/markets?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
  return await res.json();
}

function applyBasicFilters(markets) {
  const now = new Date();
  return markets.filter((m) => {
    if (!m.enableOrderBook || !m.clobTokenIds || m.clobTokenIds.length === 0) return false;
    
    const liquidity = parseFloat(m.liquidity || 0);
    if (liquidity < SCANNER_CONFIG.MIN_LIQUIDITY) return false;

    const vol24h = parseFloat(m.volume24hr || m.volume || 0);
    if (vol24h < SCANNER_CONFIG.MIN_VOLUME_24H) return false;

    if (m.endDate) {
      const resolveDate = new Date(m.endDate);
      const daysLeft = (resolveDate - now) / (1000 * 60 * 60 * 24);
      if (daysLeft > SCANNER_CONFIG.MAX_DAYS_TO_RESOLVE || daysLeft < 0) return false;
    }

    if (m.outcomePrices) {
      const prices = JSON.parse(m.outcomePrices);
      const yesPrice = parseFloat(prices[0]);
      if (yesPrice < SCANNER_CONFIG.PRICE_RANGE.min || yesPrice > SCANNER_CONFIG.PRICE_RANGE.max) return false;
    }
    return true;
  });
}

async function enrichWithClobData(markets) {
  const results = [];
  for (const market of markets) {
    try {
      const tokenIds = JSON.parse(market.clobTokenIds);
      const yesTokenId = tokenIds[0];

      const spreadRes = await fetch(`${CLOB_API}/spread?token_id=${yesTokenId}`);
      if (!spreadRes.ok) continue;
      const spreadData = await spreadRes.json();
      const spread = parseFloat(spreadData.spread || 999);

      if (spread > SCANNER_CONFIG.MAX_SPREAD) continue;

      const midRes = await fetch(`${CLOB_API}/midpoint?token_id=${yesTokenId}`);
      const midData = midRes.ok ? await midRes.json() : {};
      const midpointPrice = parseFloat(midData.mid || 0);

      const bookRes = await fetch(`${CLOB_API}/book?token_id=${yesTokenId}`);
      const bookData = bookRes.ok ? await bookRes.json() : {};

      const bidDepth = (bookData.bids || []).slice(0, 3).reduce((sum, b) => sum + parseFloat(b.size || 0), 0);
      const askDepth = (bookData.asks || []).slice(0, 3).reduce((sum, a) => sum + parseFloat(a.size || 0), 0);

      const yesPrice = midpointPrice || parseFloat(JSON.parse(market.outcomePrices || "[0]")[0]);
      const daysLeft = market.endDate ? Math.ceil((new Date(market.endDate) - new Date()) / (1000 * 60 * 60 * 24)) : 0;

      results.push({
        conditionId: market.conditionId,
        question: market.question || market.title,
        endDate: market.endDate,
        daysLeft,
        yesPrice,
        noPrice: 1 - yesPrice,
        spread,
        liquidity,
        volume24h: parseFloat(market.volume24hr || 0),
        bidDepth,
        askDepth,
        yesTokenId,
        noTokenId: tokenIds[1],
        score: calculateScore({ liquidity, volume24h: parseFloat(market.volume24hr || 0), spread, bidDepth, askDepth }),
      });

      await sleep(200);
    } catch (err) {
      console.warn(`⚠️  Skip market ${market.conditionId}: ${err.message}`);
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function calculateScore({ liquidity, volume24h, spread, bidDepth, askDepth }) {
  const liquidityScore = Math.min(liquidity / 100_000, 1);
  const volumeScore = Math.min(volume24h / 50_000, 1);
  const spreadScore = Math.max(0, 1 - spread / 0.05);
  const depthScore = Math.min((bidDepth + askDepth) / 1000, 1);
  return liquidityScore * 0.35 + volumeScore * 0.30 + spreadScore * 0.25 + depthScore * 0.10;
}

function calculateEdge(marketPrice, estimatedProbability) {
  return estimatedProbability - marketPrice;
}

function calculateKellyBet(winProbability, odds, bankroll, fraction = 0.25) {
  const b = odds - 1;
  const p = winProbability;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  if (kelly <= 0) return 0;
  return Math.min(kelly * fraction * bankroll, TRADING_CONFIG.MAX_POSITION_SIZE);
}

async function runScanner() {
  console.log(`[${new Date().toISOString()}] 🔍 Running Polymarket Scanner...`);
  try {
    const rawMarkets = await fetchActiveMarkets();
    const basicFiltered = applyBasicFilters(rawMarkets);
    if (basicFiltered.length === 0) {
      marketCache = { lastUpdate: new Date(), data: [] };
      return [];
    }
    const qualifiedMarkets = await enrichWithClobData(basicFiltered);
    marketCache = { lastUpdate: new Date(), data: qualifiedMarkets };
    console.log(`[${new Date().toISOString()}] ✅ Found ${qualifiedMarkets.length} qualified markets`);
    return qualifiedMarkets;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Scanner error:`, err.message);
    return marketCache.data;
  }
}

function generateExcel(markets) {
  const data = markets.map((m, i) => ({
    Rank: i + 1,
    Question: m.question,
    YES_Price: parseFloat(m.yesPrice.toFixed(3)),
    NO_Price: parseFloat(m.noPrice.toFixed(3)),
    Spread: parseFloat(m.spread.toFixed(4)),
    Liquidity: Math.round(m.liquidity),
    Volume_24h: Math.round(m.volume24h),
    Days_Left: m.daysLeft,
    Score: parseFloat((m.score * 100).toFixed(1)),
    YES_Token: m.yesTokenId,
    NO_Token: m.noTokenId,
    Condition_ID: m.conditionId,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Markets");

  const colWidths = [
    { wch: 5 }, { wch: 80 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 40 }
  ];
  ws['!cols'] = colWidths;

  const excelDir = path.join(__dirname, 'output');
  if (!fs.existsSync(excelDir)) fs.mkdirSync(excelDir);

  const filePath = path.join(excelDir, `markets_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, filePath);
  return filePath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== TRADING FUNCTIONS ====================

app.get('/api/markets', async (req, res) => {
  const markets = await runScanner();
  res.json({
    success: true,
    timestamp: marketCache.lastUpdate,
    count: markets.length,
    data: markets
  });
});

app.get('/api/markets/excel', async (req, res) => {
  const markets = await runScanner();
  if (markets.length === 0) {
    return res.status(404).json({ success: false, message: 'No markets found' });
  }
  const filePath = generateExcel(markets);
  res.download(filePath);
});

app.get('/api/positions', (req, res) => {
  res.json({
    positions,
    balance: walletBalance,
    totalValue: walletBalance + positions.reduce((sum, p) => sum + p.value, 0)
  });
});

app.post('/api/order', async (req, res) => {
  const { marketId, side, amount, estimatedProb } = req.body;
  
  if (!marketId || !side || !amount) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const market = marketCache.data.find(m => m.conditionId === marketId);
  if (!market) {
    return res.status(404).json({ success: false, message: 'Market not found' });
  }

  const edge = calculateEdge(market.yesPrice, estimatedProb || market.yesPrice);
  
  if (edge < TRADING_CONFIG.MIN_EDGE) {
    return res.json({ 
      success: false, 
      message: `Edge too small: ${(edge * 100).toFixed(1)}% (min: ${TRADING_CONFIG.MIN_EDGE * 100}%)`,
      edge: edge
    });
  }

  const odds = side === 'YES' ? 1 / market.yesPrice : 1 / market.noPrice;
  const kellySize = calculateKellyBet(estimatedProb || market.yesPrice, odds, walletBalance, TRADING_CONFIG.KELLY_FRACTION);
  
  const orderAmount = Math.min(amount, kellySize, walletBalance);
  
  const position = {
    id: Date.now(),
    marketId,
    marketQuestion: market.question,
    side,
    amount: orderAmount,
    price: side === 'YES' ? market.yesPrice : market.noPrice,
    value: orderAmount * (side === 'YES' ? market.yesPrice : market.noPrice),
    estimatedProb: estimatedProb || market.yesPrice,
    edge,
    openTime: new Date().toISOString(),
    tokenId: side === 'YES' ? market.yesTokenId : market.noTokenId
  };

  positions.push(position);
  walletBalance -= orderAmount;

  console.log(`[ORDER] ${side} ${orderAmount.toFixed(2)} @ $${position.price.toFixed(3)} | Edge: ${(edge * 100).toFixed(1)}%`);

  res.json({ success: true, position, balance: walletBalance });
});

app.post('/api/close-position', (req, res) => {
  const { positionId } = req.body;
  const idx = positions.findIndex(p => p.id === positionId);
  
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Position not found' });
  }

  const pos = positions[idx];
  const returnAmount = pos.side === 'YES' ? pos.value : pos.amount;
  walletBalance += returnAmount;
  
  console.log(`[CLOSE] ${pos.side} ${pos.amount.toFixed(2)} | Return: $${returnAmount.toFixed(2)}`);
  
  positions.splice(idx, 1);
  res.json({ success: true, closedPosition: pos, balance: walletBalance });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    port: PORT,
    lastUpdate: marketCache.lastUpdate,
    markets_count: marketCache.data.length,
    positions: positions.length,
    balance: walletBalance
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Polymarket Bot v03 running on port ${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/markets`);
  console.log(`   Excel: http://localhost:${PORT}/api/markets/excel`);
  console.log(`   Positions: http://localhost:${PORT}/api/positions`);
  
  runScanner();
  cron.schedule('*/5 * * * *', () => {
    console.log(`[${new Date().toISOString()}] ⏰ Scheduled scan...`);
    runScanner();
  });
});