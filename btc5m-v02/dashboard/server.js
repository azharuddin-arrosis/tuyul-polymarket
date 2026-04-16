const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const BOT_API = process.env.BOT_API || 'http://localhost:8082';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Fetch helper
async function fetchBot(endpoint, options = {}) {
    try {
        const res = await fetch(`${BOT_API}${endpoint}`, options);
        if (!res.ok) {
            console.error(`Bot API error ${res.status} on ${endpoint}`);
            return { status: "error", message: `Bot returned ${res.status}` };
        }
        return await res.json();
    } catch (e) {
        console.error(`Error fetching ${endpoint}:`, e.message);
        return null;
    }
}

// Socket.io - Real-time updates
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Send initial data
    sendUpdate();
    
    // Poll every 1 second
    const interval = setInterval(sendUpdate, 1000);
    
    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('Client disconnected');
    });
});

async function sendUpdate() {
    const [state, markets, history] = await Promise.all([
        fetchBot('/api/state'),
        fetchBot('/api/markets'),
        fetchBot('/api/history')
    ]);
    
    io.emit('update', { state, markets, history });
}

// API proxy endpoints (for frontend)
app.get('/api/state', async (req, res) => {
    const data = await fetchBot('/api/state');
    res.json(data);
});

app.get('/api/markets', async (req, res) => {
    const data = await fetchBot('/api/markets');
    res.json(data);
});

app.get('/api/history', async (req, res) => {
    const data = await fetchBot('/api/history');
    res.json(data);
});

app.post('/api/settings', async (req, res) => {
    const result = await fetchBot('/api/settings', {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: { 'Content-Type': 'application/json' }
    });
    res.json(result);
});

app.post('/api/simulate', async (req, res) => {
    const result = await fetchBot('/api/simulate', {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: { 'Content-Type': 'application/json' }
    });
    res.json(result);
});

app.post('/api/sell', async (req, res) => {
    const result = await fetchBot('/api/sell', {
        method: 'POST',
        body: JSON.stringify(req.body),
        headers: { 'Content-Type': 'application/json' }
    });
    res.json(result);
});

app.post('/api/reset', async (req, res) => {
    const result = await fetchBot('/api/reset', {
        method: 'POST'
    });
    res.json(result);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`BTC 5m Dashboard running on http://localhost:${PORT}`);
    console.log(`Connecting to bot at: ${BOT_API}`);
});