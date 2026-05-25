import { createServer } from 'node:http';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

// ── Config from env ──────────────────────────────────────────
const PK = process.env.POLY_PRIVATE_KEY?.startsWith('0x')
    ? process.env.POLY_PRIVATE_KEY
    : '0x' + (process.env.POLY_PRIVATE_KEY || '');
const FUNDER = process.env.POLY_FUNDER || '';
const API_KEY = process.env.POLY_API_KEY || '';
const SECRET = process.env.POLY_SECRET || '';
const PASSPHRASE = process.env.POLY_PASSPHRASE || '';
const BUILDER_CODE = process.env.BUILDER_CODE || '0x' + '0'.repeat(64);
const PORT = parseInt(process.env.ORDER_SERVICE_PORT || '3100');

const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

if (!PK || !FUNDER || !API_KEY) {
    console.error('Missing POLY_PRIVATE_KEY, POLY_FUNDER, or POLY_API_KEY');
    process.exit(1);
}

// ── Init CLOB Client ──────────────────────────────────────────
const account = privateKeyToAccount(PK);
const signer = createWalletClient({ account, transport: http(), chain: polygon });

const client = new ClobClient({
    host: HOST,
    chain: CHAIN_ID,
    signer,
    creds: {
        key: API_KEY,
        secret: SECRET,
        passphrase: PASSPHRASE,
    },
    signatureType: 1,
});

console.log('CLOB client ready — POLY_PROXY mode (sig_type=1)');
console.log('API key:', API_KEY.slice(0, 12) + '...');

// ── HTTP Server ───────────────────────────────────────────────
const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method !== 'POST' || req.url !== '/order') {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'not found' }));
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    let params;
    try {
        params = JSON.parse(body);
    } catch {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'invalid json' }));
    }

    const { token_id, price, size, side, order_type } = params;
    if (!token_id || !price || !size) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'missing token_id/price/size' }));
    }

    try {
        const orderSide = (side || 'BUY').toUpperCase() === 'SELL' ? Side.SELL : Side.BUY;
        const orderType = order_type === 'FOK' ? OrderType.FOK
            : order_type === 'GTD' ? OrderType.GTD
            : OrderType.GTC;

        const resp = await client.createAndPostOrder(
            { tokenID: token_id, price, size, side: orderSide },
            { tickSize: '0.01', negRisk: false },
            orderType,
        );

        console.log(`[ORDER] RAW RESPONSE: ${JSON.stringify(resp)}`);

        const success = (resp?.success === true || !!resp?.orderID)
            && !resp?.error
            && resp?.status !== 400;

        if (success) {
            console.log(`[ORDER] OK orderID=${resp.orderID}`);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, orderID: resp.orderID, status: resp.status }));
        } else {
            const err = resp?.error || resp?.errorMsg || 'order rejected';
            console.log(`[ORDER] FAILED: ${err}`);
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: err }));
        }
    } catch (e) {
        console.error(`[ORDER] EXCEPTION: ${e.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Order service listening on http://127.0.0.1:${PORT}`);
});
