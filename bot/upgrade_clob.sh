#!/bin/bash
# upgrade_clob.sh — Upgrade py-clob-client ke versi terbaru
#
# Jalankan ini kalau bot tiba-tiba error "order_version_mismatch"
# Itu artinya Polymarket update order format dan client perlu di-upgrade.
#
# Usage (dari folder bot/):
#   ./upgrade_clob.sh           # upgrade ke latest
#   ./upgrade_clob.sh 0.34.6    # upgrade ke versi tertentu
#
# Setelah upgrade, restart bot:
#   ./run.sh stop real1
#   ./run.sh real real1 -d

set -e
cd "$(dirname "$0")"

G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[0;34m'; D='\033[2m'; X='\033[0m'

PYTHON="$PWD/venv/bin/python"
if [ ! -f "$PYTHON" ]; then
    echo -e "${R}✗ venv tidak ditemukan. Setup dulu:${X}"
    echo "  python3 -m venv venv && venv/bin/pip install -r backend/requirements.txt"
    exit 1
fi

TARGET_VER="${1:-latest}"

echo ""
echo -e "${B}═══════════════════════════════════════════${X}"
echo -e "${B}  py-clob-client Upgrade Tool${X}"
echo -e "${B}═══════════════════════════════════════════${X}"

# Cek versi sekarang
CURRENT=$("$PYTHON" -c "import importlib.metadata; print(importlib.metadata.version('py-clob-client'))" 2>/dev/null || echo "not installed")
echo -e "  ${D}Current:${X} $CURRENT"

# Cek versi terbaru di PyPI
LATEST=$(curl -s "https://pypi.org/pypi/py-clob-client/json" 2>/dev/null | \
    python3 -c "import json,sys; d=json.load(sys.stdin); releases=sorted(d['releases'].keys(), key=lambda v:[int(x) for x in v.split('.')]); print(releases[-1])" 2>/dev/null || echo "unknown")
echo -e "  ${D}Latest:${X}  $LATEST"

if [ "$TARGET_VER" = "latest" ]; then
    INSTALL_VER="$LATEST"
else
    INSTALL_VER="$TARGET_VER"
fi
echo -e "  ${D}Target:${X}  $INSTALL_VER"
echo ""

if [ "$CURRENT" = "$INSTALL_VER" ]; then
    echo -e "${G}✓ Already up-to-date ($CURRENT) — tidak perlu upgrade${X}"
    echo ""
    exit 0
fi

echo -e "${Y}→ Upgrading py-clob-client $CURRENT → $INSTALL_VER ...${X}"
"$PYTHON" -m pip install "py-clob-client==$INSTALL_VER" --quiet

# Verify
NEW_VER=$("$PYTHON" -c "import importlib.metadata; print(importlib.metadata.version('py-clob-client'))" 2>/dev/null || echo "error")
if [ "$NEW_VER" = "$INSTALL_VER" ]; then
    echo -e "${G}✓ Upgrade berhasil: $CURRENT → $NEW_VER${X}"
else
    echo -e "${R}✗ Upgrade mungkin gagal. Installed: $NEW_VER${X}"
    exit 1
fi

# Cek py-order-utils
ORDER_UTILS_CURRENT=$("$PYTHON" -c "import importlib.metadata; print(importlib.metadata.version('py-order-utils'))" 2>/dev/null || echo "not installed")
ORDER_UTILS_LATEST=$(curl -s "https://pypi.org/pypi/py-order-utils/json" 2>/dev/null | \
    python3 -c "import json,sys; d=json.load(sys.stdin); releases=sorted(d['releases'].keys(), key=lambda v:[int(x) for x in v.split('.')]); print(releases[-1])" 2>/dev/null || echo "unknown")

echo -e "  ${D}py-order-utils:${X} $ORDER_UTILS_CURRENT (latest: $ORDER_UTILS_LATEST)"
if [ "$ORDER_UTILS_CURRENT" != "$ORDER_UTILS_LATEST" ] && [ "$ORDER_UTILS_LATEST" != "unknown" ]; then
    echo -e "${Y}→ Upgrading py-order-utils $ORDER_UTILS_CURRENT → $ORDER_UTILS_LATEST ...${X}"
    "$PYTHON" -m pip install "py-order-utils==$ORDER_UTILS_LATEST" --quiet
    echo -e "${G}✓ py-order-utils upgraded${X}"
else
    echo -e "${G}✓ py-order-utils sudah up-to-date ($ORDER_UTILS_CURRENT)${X}"
fi

# Update requirements.txt
REQ_FILE="backend/requirements.txt"
if [ -f "$REQ_FILE" ]; then
    # Update baris py-clob-client di requirements.txt
    sed -i.bak "s/py-clob-client==[0-9.]*/py-clob-client==$NEW_VER/" "$REQ_FILE"
    rm -f "$REQ_FILE.bak"
    echo -e "${G}✓ requirements.txt updated → py-clob-client==$NEW_VER${X}"
fi

echo ""
echo -e "${G}═══════════════════════════════════════════${X}"
echo -e "${G}  Done! Restart bot untuk apply:${X}"
echo -e "  ${Y}./run.sh stop real1${X}"
echo -e "  ${Y}./run.sh real real1 -d${X}"
echo -e "${G}═══════════════════════════════════════════${X}"
echo ""
