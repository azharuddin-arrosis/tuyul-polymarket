# Panduan Polymarket Auto-Redeem & Transaksi Tanpa Gas

## Ringkasan

Polymarket baru saja meluncurkan dua fitur utama untuk mengelola posisi dengan lebih mudah:
1. **Auto-Redeem UI** — Pengguna bisa mengaktifkan redemption otomatis untuk kemenangan
2. **Builder Relayer Client** — Redemption terprogram dengan biaya gas NOL untuk bot

---

## Bagian 1: Fitur Auto-Redeem UI

### Apa Itu?
Polymarket menambahkan setting **Auto-Redeem** yang otomatis menukar token pemenang dari pasar yang sudah resolved tanpa perlu tindakan manual. User bisa aktifkan dari:

```
Settings → Trading → Auto-Redeem (toggle ON)
```

### Keuntungan
- **Tidak perlu claim manual** — Posisi pemenang otomatis ditukar saat market resolved
- **Lebih sedikit transaksi** — Satu operasi mengubah token → pUSD
- **UX lebih baik** — Aktifkan sekali, lalu biarkan jalan 24/7

### Keterbatasan Saat Ini
- Hanya via UI (belum ada API endpoint)
- Butuh user aktifkan di dashboard Polymarket
- Bot tidak bisa kontrol programmatically

---

## Bagian 2: Builder Relayer Client (Redemption Tanpa Gas)

### Masalahnya
Sebelumnya, bot kami (dan semua pengguna Polymarket) harus:
1. Simpan POL di wallet untuk bayar gas
2. Panggil `redeem_positions()` langsung ke smart contract
3. Bayar gas fee (biasanya 0.5-2 POL per redemption)

**py-clob-client tidak punya method `redeem_positions()`** — ini masih menjadi [fitur yang diminta](https://github.com/Polymarket/py-clob-client/issues/139) dengan 42+ upvotes tapi belum diimplementasikan.

### Solusinya: Builder Relayer Client

Polymarket menyediakan **Builder Relayer Client** yang:
- **Eksekusi transaksi dengan NOL biaya gas** (Polymarket bayar relayer)
- **Hanya butuh API credentials** (tidak perlu POL di wallet)
- **Handle smart contract calls** (redeem, approve, split, merge)
- **Tersedia di TypeScript + Python**

### Cara Kerjanya

```
Bot buat transaksi
    ↓
Bot tanda-tangan dengan private key
    ↓
Bot kirim ke Polymarket Relayer API
    ↓
Relayer submit ke blockchain (Polymarket bayar gas)
    ↓
Transaksi eksekusi dari Safe wallet user
    ↓
Token pemenang → pUSD (nol biaya)
```

### Setup: Builder Relayer Client

**1. Install SDK**

```bash
# Python
pip install @polymarket/builder-relayer-client
# atau untuk Polygon
pip install polymarket-py

# TypeScript/Node
npm install @polymarket/builder-relayer-client
```

**2. Dapatkan API Credentials**

Pergi ke [Polymarket Settings → API Keys](https://polymarket.com/settings?tab=builder) dan buat Builder API Key:
- `RELAYER_API_KEY` — API key
- `RELAYER_API_KEY_ADDRESS` — Alamat wallet yang terkait
- `RELAYER_API_HOST` — `https://relayer-v2.polymarket.com/`

Simpan di `.env`:
```bash
RELAYER_API_KEY=your_key
RELAYER_API_KEY_ADDRESS=0x...
RELAYER_API_HOST=https://relayer-v2.polymarket.com/
```

**3. Inisialisasi Client**

```typescript
import { RelayClient } from "@polymarket/builder-relayer-client";

const client = new RelayClient({
  host: process.env.RELAYER_API_HOST,
  chain: 137,  // Polygon
  signer: userWallet,  // ethers.js Signer atau equivalent
  relayerApiKey: process.env.RELAYER_API_KEY,
  relayerApiKeyAddress: process.env.RELAYER_API_KEY_ADDRESS,
});
```

**4. Redeem Posisi**

```typescript
// Buat transaksi redeem
const redeemTx = {
  to: CTF_ADDRESS,  // Conditional Token Framework contract
  data: encodeFunctionData({
    abi: clobAbi,
    functionName: "redeemPositions",
    args: [
      collateralToken,  // USDC
      parentCollectionId,  // 0 untuk kebanyakan kasus
      conditionId,  // hex string dari Polymarket
      indexSets,  // [1] untuk YES atau [2] untuk NO (atau keduanya)
    ],
  }),
  value: "0",
};

// Eksekusi via relayer (nol gas)
const response = await client.execute([redeemTx], "Redeem kemenangan");
await response.wait();
```

---

## Bagian 3: Implikasi untuk Bot Kami

### Implementasi Saat Ini
Backend kami (`backend/main.py`) sekarang punya:
```python
async def redeem_winning_positions():
    """Real mode saja: polling market resolved dan claim kemenangan"""
    # Saat ini: pakai py-clob-client (terbatas)
    # Manual panggil client.redeem_positions() jika tersedia
```

**Status saat ini:** Sudah coba panggil `redeem_positions()` via py-clob-client, tapi mungkin tidak semua Safe wallet di Polygon support.

### Jalur Upgrade yang Direkomendasikan

**Opsi A: Tambah Builder Relayer Client (DIREKOMENDASIKAN)**

Keuntungan:
- Nol biaya gas (tidak perlu POL)
- Jalan reliable dengan Safe wallet Polygon
- Kontrol smart contract call langsung
- Future-proof untuk skala besar

Implementasi:
```python
import asyncio
from polymarket_py import RelayClient

async def redeem_winning_positions_gasless():
    """Redeem via Builder Relayer (nol gas)"""
    client = RelayClient(
        host=os.getenv("RELAYER_API_HOST"),
        signer=wallet,  # signer tipe ethers
        relayer_api_key=os.getenv("RELAYER_API_KEY"),
    )
    
    # Cari semua posisi yang resolved
    for pos in S.positions:
        if pos["status"] == "resolved" and pos.get("won"):
            # Buat redeem call
            tx = {
                "to": CTF_ADDRESS,
                "data": encode_redeem_call(
                    conditionId=pos["condition_id"],
                    indexSet=[1 if pos["outcome"] == "UP" else 2],
                )
            }
            
            # Eksekusi via relayer
            response = await client.execute([tx], f"Redeem {pos['id']}")
            await response.wait()
            
            add_log("REDEEM_SUCCESS", {"position_id": pos["id"], "gas_cost": "0"})
```

**Opsi B: Tetap Pakai py-clob-client (Saat Ini)**

- Lebih simpel (minimal perubahan kode)
- Masih perlu POL untuk gas
- Bisa fail untuk Safe multisig wallet
- Terbatas karena py-clob-client tidak officially support

### Perbandingan Biaya

| Metode | Biaya Gas | Frekuensi | Biaya Bulanan |
|---|---|---|---|
| Direct contract calls | ~0.5-2 POL per tx | 1-5 per hari | $60-600 (POL naik turun) |
| Builder Relayer | **$0** | 1-5 per hari | **$0** |
| UI Manual claim | Variabel | Manual | Tidak pasti |

**Skala besar (6 bots):** Relayer hemat ~$300-3600/bulan biaya gas.

---

## Bagian 4: Checklist Integrasi

Untuk upgrade bot kami dengan auto-redemption via Builder Relayer:

- [ ] Install `polymarket-py` atau TypeScript `@polymarket/builder-relayer-client`
- [ ] Tambah RELAYER_API_KEY, RELAYER_API_KEY_ADDRESS ke env file bot
- [ ] Implementasi `redeem_winning_positions_gasless()` di `main.py`
- [ ] Ganti logika `redeem_winning_positions()` yang lama
- [ ] Test di dry_run mode (mock relayer responses)
- [ ] Test di real mode dengan modal kecil ($10-50)
- [ ] Monitor log redemption untuk success/failure
- [ ] Setup cron alert jika redemption gagal 3+ kali

---

## Bagian 5: Referensi

| Resource | Link |
|---|---|
| Polymarket Gasless Docs | [docs.polymarket.com/trading/gasless](https://docs.polymarket.com/trading/gasless) |
| Polymarket Token Redemption | [docs.polymarket.com/trading/ctf/redeem](https://docs.polymarket.com/trading/ctf/redeem) |
| Builder Relayer (TypeScript) | [GitHub: Polymarket/builder-relayer-client](https://github.com/Polymarket/builder-relayer-client) |
| Polymarket Auto-Redeem News | [KuCoin: Auto-Redeem Feature](https://www.kucoin.com/news/community/POL/69e72f369b8ebc0007ccf822) |
| py-clob-client V2 | [GitHub: py-clob-client-v2](https://github.com/Polymarket/py-clob-client-v2) |
| Community Gasless Redeem CLI | [GitHub: polymarket-gasless-redeem-cli](https://github.com/NocodeSolutions/polymarket-gasless-redeem-cli) |

---

## Keputusan Selanjutnya

**Apakah kita integrate Builder Relayer Client ke bot kami?**

**Keuntungan:**
- ✅ Nol biaya gas (hemat besar di skala)
- ✅ Support semua tipe wallet (EOA + Safe multisig)
- ✅ Lebih reliable dari cara sekarang
- ✅ Future-proof untuk 6-bot VPS

**Kekurangan:**
- ❌ Butuh setup API credentials tambahan
- ❌ Dependency baru (slight complexity increase)
- ❌ Perlu test integrasi

**Rekomendasi:** **YA** — integrate saat phase VPS deployment biar redemption reliable dan cost-efficient di skala besar.

