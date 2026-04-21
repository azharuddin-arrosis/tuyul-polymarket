def parse_market(m: dict) -> Optional[dict]:
    """Parse raw Gamma market into bot format"""
    tokens = m.get("tokens", [])
    yes_t  = next((t for t in tokens if t.get("outcome") == "Yes"), None)
    no_t   = next((t for t in tokens if t.get("outcome") == "No"),  None)
    if not yes_t or not no_t: return None
    yes_p = float(yes_t.get("price", 0) or 0)
    no_p  = float(no_t.get("price", 0)  or 0)
    if yes_p <= 0 or no_p <= 0: return None
    vol = float(m.get("volume", 0) or 0)
    return {
        "id":       m.get("id", ""),
        "question": m.get("question", "")[:80],
        "category": (m.get("category") or m.get("_fetched_cat", "other")).lower(),
        "yes_price": round(yes_p, 4),
        "no_price":  round(no_p, 4),
        "volume":    round(vol, 2),
        "end_date":  m.get("endDate", ""),
        "spread":    round(abs(1 - yes_p - no_p), 4),
    }