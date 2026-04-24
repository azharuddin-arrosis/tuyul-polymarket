const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Bot configurations - support both bot1 and bot2
const BOTS = {
    bot1: process.env.BOT1_API || 'http://localhost:8001',
    bot2: process.env.BOT2_API || 'http://localhost:8002'
};

const DEFAULT_BOT = process.env.DEFAULT_BOT || 'bot1';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Get bot URL based on bot identifier
function getBotUrl(botId) {
    const bot = botId || DEFAULT_BOT;
    return BOTS[bot] || BOTS[DEFAULT_BOT];
}

function getBotId(url) {
    for (const [id, botUrl] of Object.entries(BOTS)) {
        if (url === botUrl) return id;
    }
    return DEFAULT_BOT;
}

// Fetch helper
async function fetchBot(botId, endpoint, options = {}) {
    const botUrl = getBotUrl(botId);
    // Remove leading slash from endpoint if present
    const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    try {
        const res = await fetch(`${botUrl}/${path}`, options);
        if (!res.ok) {
            console.error(`Bot API error ${res.status} on ${endpoint} (bot: ${botId})`);
            return { status: "error", message: `Bot returned ${res.status}` };
        }
        return await res.json();
    } catch (e) {
        console.error(`Error fetching ${endpoint} (bot: ${botId}):`, e.message);
        return null;
    }
}

// Socket.io - Real-time updates
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Get bot from query param or use default
    const botId = socket.handshake.query.bot || DEFAULT_BOT;
    console.log(`Client connected for bot: ${botId}`);
    
    // Send initial data for the selected bot
    sendUpdate(botId);
    
    // Poll every 1 second
    const interval = setInterval(() => sendUpdate(botId), 1000);
    
    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('Client disconnected');
    });
});

async function sendUpdate(botId) {
    const [state, markets, history] = await Promise.all([
        fetchBot(botId, '/api/state'),
        fetchBot(botId, '/api/markets'),
        fetchBot(botId, '/api/history')
    ]);
    
    io.emit('update', { state, markets, history, botId });
}

// API proxy endpoints (for frontend) - support bot query param
app.get('/api/state', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const data = await fetchBot(botId, '/api/state');
    res.json(data);
});

app.get('/api/markets', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const data = await fetchBot(botId, '/api/markets');
    res.json(data);
});

app.get('/api/history', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const data = await fetchBot(botId, '/api/history');
    res.json(data);
});

app.post('/api/settings', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const result = await fetchBot(botId, '/api/settings', {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: { 'Content-Type': 'application/json' }
    });
    res.json(result);
});

app.post('/api/simulate', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const result = await fetchBot(botId, '/api/simulate', {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: { 'Content-Type': 'application/json' }
    });
    res.json(result);
});

app.post('/api/sell', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const result = await fetchBot(botId, '/api/sell', {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: { 'Content-Type': 'application/json' }
    });
    res.json(result);
});

app.post('/api/reset', async (req, res) => {
    const botId = req.query.bot || DEFAULT_BOT;
    const result = await fetchBot(botId, '/api/reset', {
        method: 'POST'
    });
    res.json(result);
});

// Get available bots
app.get('/api/bots', (req, res) => {
    res.json({
        bots: Object.keys(BOTS),
        current: DEFAULT_BOT,
        endpoints: BOTS
    });
});

// Health check - check all bots but don't block (used for monitoring)
app.get('/health', async (req, res) => {
    const results = {};
    
    for (const [botId, botUrl] of Object.entries(BOTS)) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const response = await fetch(`${botUrl}/health`, { signal: controller.signal });
            clearTimeout(timeout);
            results[botId] = response.ok ? 'ok' : `error ${response.status}`;
        } catch (e) {
            results[botId] = `unreachable: ${e.message}`;
        }
    }
    
    // For monitoring only — don't block operations
    const allOk = Object.values(results).every(r => r === 'ok');
    res.status(allOk ? 200 : 200).json({
        status: allOk ? 'ok' : 'degraded',
        bots: results
    });
});

// NEW: Aggregate state across all configured bots for dashboard
async function getAggregatedState() {
    const botStates = {};
    for (const botId of Object.keys(BOTS)) {
        try {
            const stateData = await fetchBot(botId, '/api/state');
            botStates[botId] = { ok: true, data: stateData };
        } catch (e) {
            console.error(`Failed to fetch state for ${botId}:`, e.message);
            botStates[botId] = { ok: false, error: e.message };
        }
    }
    
    // Aggregate metrics
    let totalBalance = 0;
    let totalPnL = 0;
    let totalOpenPositions = 0;
    
    for (const [botId, stateInfo] of Object.entries(botStates)) {
        if (stateInfo.ok && stateInfo.data) {
            totalBalance += stateInfo.data.usdc_balance || 0;
            totalPnL += stateInfo.data.realized_pnl || 0;
            totalOpenPositions += stateInfo.data.open_positions?.length || 0;
        }
    }
    
    return {
        aggregated: {
            totalBalance,
            totalPnL,
            totalOpenPositions,
            botCount: Object.keys(BOTS).length,
            healthyCount: Object.values(botStates).filter(b => b.ok).length
        },
        bots: botStates
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`BTC 5m Dashboard running on http://localhost:${PORT}`);
    console.log(`Connected bots:`, BOTS);
});