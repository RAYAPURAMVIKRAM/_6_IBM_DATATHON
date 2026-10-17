import os
import requests
import sqlite3
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Directory Setup
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR / "portfolio.db"

# ---------------------------------------------------------------------------
# Load Environment Variables (never hardcode credentials)
# ---------------------------------------------------------------------------
load_dotenv(dotenv_path=BASE_DIR / ".env")

FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "").strip()
ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "").strip()
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY", "").strip()
ALPACA_BASE_URL = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets/v2").strip()

# ---------------------------------------------------------------------------
# Negative-sentiment keywords to watch for in market news
# ---------------------------------------------------------------------------
RISK_KEYWORDS = [
    "crash", "drop", "lawsuit", "fraud", "bankruptcy", "recession",
    "decline", "plunge", "default", "loss", "warning", "risk",
    "panic", "sell-off", "downturn", "collapse", "investigation",
]

# ---------------------------------------------------------------------------
# Server-Side Defense State
# Persists across requests for the lifetime of the server process.
# defense_status: "STANDBY" | "DEFENSE_ACTIVE"
# ai_defense_enabled: True (Active) | False (Disabled)
# ---------------------------------------------------------------------------
defense_status: str = "STANDBY"
ai_defense_enabled: bool = True

# ---------------------------------------------------------------------------
# SQLite Database Setup: portfolio.db with table 'Holdings'
# (Symbol, Quantity, Avg_Price)
# ---------------------------------------------------------------------------
def init_db():
    """Initializes local SQLite portfolio.db and creates 'Holdings' table."""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Holdings (
            Symbol TEXT PRIMARY KEY,
            Quantity REAL NOT NULL,
            Avg_Price REAL NOT NULL
        )
    """)
    conn.commit()

    # Seed default portfolio holdings if table is empty
    cursor.execute("SELECT COUNT(*) FROM Holdings")
    count = cursor.fetchone()[0]
    if count == 0:
        seed_holdings = [
            ("AAPL", 15.0, 168.50),
            ("NVDA", 12.0, 118.25),
            ("MSFT", 8.0, 412.30),
            ("TSLA", 10.0, 215.40),
            ("AMZN", 14.0, 178.60),
            ("GOOGL", 10.0, 155.80),
        ]
        cursor.executemany("INSERT INTO Holdings (Symbol, Quantity, Avg_Price) VALUES (?, ?, ?)", seed_holdings)
        conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Stock metadata for rich display and valuation
STOCK_METADATA = {
    "AAPL": {
        "name": "Apple Inc.",
        "sector": "Consumer Electronics",
        "simulated_price": 173.42,
        "daily_change_pct": 2.14,
        "icon": "🍎",
        "safe_haven_pair": "GLD",
        "protection_tier": "Maximum Shield",
    },
    "NVDA": {
        "name": "NVIDIA Corporation",
        "sector": "Semiconductors & AI",
        "simulated_price": 124.60,
        "daily_change_pct": 4.85,
        "icon": "⚡",
        "safe_haven_pair": "GLD",
        "protection_tier": "High Volatility",
    },
    "MSFT": {
        "name": "Microsoft Corporation",
        "sector": "Enterprise Software & Cloud",
        "simulated_price": 428.15,
        "daily_change_pct": 1.25,
        "icon": "💻",
        "safe_haven_pair": "TLT",
        "protection_tier": "Core Defense",
    },
    "TSLA": {
        "name": "Tesla, Inc.",
        "sector": "Automotive & Clean Energy",
        "simulated_price": 224.80,
        "daily_change_pct": -1.45,
        "icon": "🚗",
        "safe_haven_pair": "SHV",
        "protection_tier": "High Volatility",
    },
    "AMZN": {
        "name": "Amazon.com, Inc.",
        "sector": "E-Commerce & AWS Cloud",
        "simulated_price": 186.20,
        "daily_change_pct": 1.88,
        "icon": "📦",
        "safe_haven_pair": "BIL",
        "protection_tier": "Core Defense",
    },
    "GOOGL": {
        "name": "Alphabet Inc.",
        "sector": "Search, Media & Cloud",
        "simulated_price": 162.75,
        "daily_change_pct": 0.95,
        "icon": "🔍",
        "safe_haven_pair": "TLT",
        "protection_tier": "Core Defense",
    },
}

# Defensive Safe Haven Recommendations
SAFE_HAVEN_ASSETS = [
    {
        "symbol": "GLD",
        "name": "SPDR Gold Trust ETF",
        "asset_class": "Physical Commodity / Gold Bullion",
        "current_price_usd": 218.45,
        "crash_protection_score": 96,
        "equity_beta": -0.42,
        "recommended_allocation_pct": 25,
        "description": "Historical ultimate hedge against equity market capitulation and fiat currency devaluation.",
        "crisis_return_estimate": "+8.4%",
        "icon": "🪙",
    },
    {
        "symbol": "TLT",
        "name": "iShares 20+ Year Treasury Bond ETF",
        "asset_class": "US Sovereign Long-Duration Debt",
        "current_price_usd": 94.20,
        "crash_protection_score": 88,
        "equity_beta": -0.68,
        "recommended_allocation_pct": 20,
        "description": "Flight-to-safety sovereign hedge. Government yields drop and bond prices surge during market sell-offs.",
        "crisis_return_estimate": "+12.1%",
        "icon": "🏛️",
    },
    {
        "symbol": "SHV",
        "name": "iShares Short Treasury Bond ETF",
        "asset_class": "Ultra-Short Cash Equivalent (0-1Y)",
        "current_price_usd": 110.15,
        "crash_protection_score": 99,
        "equity_beta": 0.01,
        "recommended_allocation_pct": 35,
        "description": "Zero duration risk fortress. Instant capital lock-in with zero market drawdown risk during volatility spikes.",
        "crisis_return_estimate": "+5.1% Yield",
        "icon": "🛡️",
    },
    {
        "symbol": "BIL",
        "name": "SPDR Bloomberg 1-3 Month T-Bill ETF",
        "asset_class": "Short-Term Treasury Bill Haven",
        "current_price_usd": 91.50,
        "crash_protection_score": 98,
        "equity_beta": 0.00,
        "recommended_allocation_pct": 20,
        "description": "Liquid cash management instrument yielding risk-free return while awaiting post-crash entry opportunities.",
        "crisis_return_estimate": "+5.2% Yield",
        "icon": "💵",
    },
]

# ---------------------------------------------------------------------------
# Alpaca helper: build authenticated request headers
# ---------------------------------------------------------------------------
def _alpaca_headers() -> dict:
    """Return Alpaca authentication headers loaded from environment."""
    return {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
        "Content-Type": "application/json",
    }

# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="RiskGuard AI – Capital Defense & Portfolio Protection",
    description=(
        "Production-ready FastAPI Risk Agent. Features SQLite portfolio tracking, "
        "sentiment-triggered defensive execution via Alpaca Paper Trading, "
        "and Safe Haven hedging recommendations."
    ),
    version="3.5.0",
)

# Mount /static directory to serve HTML/JS files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ---------------------------------------------------------------------------
# Route: App Root (Serves Frontend UI) & Health Check
# ---------------------------------------------------------------------------
@app.get("/", tags=["Dashboard"])
def root():
    """Serves the production dashboard UI index.html, with fallback to API status."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {
        "status": "healthy",
        "message": "RiskGuard AI Risk Agent is running",
        "version": "3.5.0",
        "defense_status": defense_status,
        "ai_defense_enabled": ai_defense_enabled,
    }


@app.get("/health", tags=["Health"])
def health():
    """Dedicated health check endpoint."""
    return {
        "status": "healthy",
        "defense_status": defense_status,
        "ai_defense_enabled": ai_defense_enabled,
    }


# ---------------------------------------------------------------------------
# Route 1: /api/market-status
# ---------------------------------------------------------------------------
@app.get("/api/market-status", tags=["Risk Agent"])
def market_status():
    """
    Fetches the latest general market news from Finnhub and filters
    articles that contain negative-sentiment keywords. Returns a risk
    assessment based on the number of flagged headlines.
    """
    if not FINNHUB_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="FINNHUB_API_KEY is not configured. Check your .env file.",
        )

    # Call Finnhub General News API
    try:
        response = requests.get(
            "https://finnhub.io/api/v1/news",
            params={"category": "general", "token": FINNHUB_API_KEY},
            timeout=10,
        )
        response.raise_for_status()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Finnhub API request timed out.")
    except requests.exceptions.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Finnhub API error: {str(exc)}")

    news_items = response.json()

    # Filter articles containing negative-sentiment keywords
    flagged_articles = []
    for article in news_items:
        headline = (article.get("headline") or "").lower()
        summary = (article.get("summary") or "").lower()
        combined_text = headline + " " + summary

        matched_keywords = [kw for kw in RISK_KEYWORDS if kw in combined_text]
        if matched_keywords:
            flagged_articles.append(
                {
                    "headline": article.get("headline"),
                    "source": article.get("source"),
                    "url": article.get("url"),
                    "datetime": datetime.utcfromtimestamp(
                        article.get("datetime", 0)
                    ).strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "matched_risk_keywords": matched_keywords,
                }
            )

    risk_score = len(flagged_articles)
    if risk_score == 0:
        risk_level = "LOW"
        recommendation = "Market sentiment appears stable. No defensive action required."
    elif risk_score <= 3:
        risk_level = "MODERATE"
        recommendation = "Some negative signals detected. Monitor positions closely."
    else:
        risk_level = "HIGH"
        recommendation = "Elevated negative sentiment detected. Consider executing defense strategy."

    return {
        "status": "success",
        "risk_level": risk_level,
        "flagged_article_count": risk_score,
        "recommendation": recommendation,
        "flagged_articles": flagged_articles,
    }


# ---------------------------------------------------------------------------
# Route 2: /api/execute-defense
# ---------------------------------------------------------------------------
@app.post("/api/execute-defense", tags=["Risk Agent"])
def execute_defense(payload: dict = Body(default=None), auto: bool = False):
    """
    Defensive trade execution route.

    Guards:
      1. 24/7 AI Defense Switch: If execution was auto-triggered and
         `ai_defense_enabled` is False, bypasses execution and protects capital
         without firing an order.
      2. Server-side `defense_status`: If status is already DEFENSE_ACTIVE,
         returns an informational response without placing a duplicate order.
    """
    global defense_status, ai_defense_enabled

    is_auto = auto
    if payload:
        if "auto" in payload:
            is_auto = bool(payload.get("auto", False))
        if "ai_defense_active" in payload:
            ai_defense_enabled = bool(payload["ai_defense_active"])

    # ── Guard 1: 24/7 AI Defense toggle ───────────────────────────────────
    if is_auto and not ai_defense_enabled:
        return {
            "status": "bypassed",
            "ai_defense_enabled": False,
            "defense_status": defense_status,
            "message": "Automated Alpaca stop-loss skipped: 24/7 AI Defense toggle is set to DISABLED.",
            "capital_protected": "Automated trade execution withheld per user defense policy.",
        }

    # ── Guard 2: prevent re-execution if defense is already active ──────────
    if defense_status == "DEFENSE_ACTIVE":
        return {
            "status": "already_active",
            "defense_status": defense_status,
            "ai_defense_enabled": ai_defense_enabled,
            "message": (
                "Defense is already ACTIVE. Threat is ongoing but no further trades "
                "will be executed until the system is reset."
            ),
        }

    if not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        raise HTTPException(
            status_code=500,
            detail="Alpaca credentials are not configured. Check your .env file.",
        )

    headers = _alpaca_headers()

    # --- Step 1: Fetch current paper account balance ---
    try:
        account_resp = requests.get(
            f"{ALPACA_BASE_URL}/account",
            headers=headers,
            timeout=10,
        )
        account_resp.raise_for_status()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Alpaca account API request timed out.")
    except requests.exceptions.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Alpaca account API error: {str(exc)}")

    account_data = account_resp.json()
    portfolio_value = account_data.get("portfolio_value", "N/A")
    cash_balance = account_data.get("cash", "N/A")
    buying_power = account_data.get("buying_power", "N/A")
    account_status = account_data.get("status", "N/A")

    # --- Step 2: Submit a simulated market sell order for 1 share of AAPL ---
    order_payload = {
        "symbol": "AAPL",
        "qty": "1",
        "side": "sell",
        "type": "market",
        "time_in_force": "gtc",  # Good Till Cancelled – standard stop-loss practice
    }

    order_resp = None
    try:
        order_resp = requests.post(
            f"{ALPACA_BASE_URL}/orders",
            headers=headers,
            json=order_payload,
            timeout=10,
        )
        order_resp.raise_for_status()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Alpaca order API request timed out.")
    except requests.exceptions.RequestException as exc:
        # Capture the response body for more descriptive errors (e.g., insufficient shares)
        detail = str(exc)
        if order_resp is not None:
            try:
                detail = order_resp.json().get("message", detail)
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"Alpaca order error: {detail}")

    order_data = order_resp.json()

    # --- Step 3: Lock defense state — no further executions until reset ---
    defense_status = "DEFENSE_ACTIVE"

    return {
        "status": "success",
        "defense_status": defense_status,
        "ai_defense_enabled": ai_defense_enabled,
        "message": "Simulated defensive sell order submitted successfully.",
        "defense_strategy": "Stop-Loss: Market Sell – 1 share of AAPL",
        "trade_details": {
            "order_id": order_data.get("id"),
            "symbol": order_data.get("symbol"),
            "qty": order_data.get("qty"),
            "side": order_data.get("side"),
            "order_type": order_data.get("type"),
            "time_in_force": order_data.get("time_in_force"),
            "order_status": order_data.get("status"),
            "submitted_at": order_data.get("submitted_at"),
        },
        "account_snapshot": {
            "account_status": account_status,
            "portfolio_value_usd": portfolio_value,
            "cash_balance_usd": cash_balance,
            "buying_power_usd": buying_power,
        },
        "capital_protected": "Defensive sell order placed. Capital protection action executed on paper trading account.",
        "disclaimer": "This is a simulated paper-trading order. No real money is involved.",
    }


# ---------------------------------------------------------------------------
# Route 3: /api/defense-status  (GET)
# ---------------------------------------------------------------------------
@app.get("/api/defense-status", tags=["Risk Agent"])
def get_defense_status():
    """Return the current server-side defense state and toggle status."""
    return {
        "defense_status": defense_status,
        "is_active": defense_status == "DEFENSE_ACTIVE",
        "ai_defense_enabled": ai_defense_enabled,
    }


# ---------------------------------------------------------------------------
# Route 4: /api/reset-defense  (POST)
# ---------------------------------------------------------------------------
@app.post("/api/reset-defense", tags=["Risk Agent"])
def reset_defense():
    """
    Resets the server-side defense_status back to STANDBY.
    Allows the system to respond to new HIGH RISK events in future scans.
    """
    global defense_status
    previous = defense_status
    defense_status = "STANDBY"
    return {
        "status": "reset",
        "previous_defense_status": previous,
        "defense_status": defense_status,
        "ai_defense_enabled": ai_defense_enabled,
        "message": "Defense system reset to STANDBY. Ready to respond to new threats.",
        "reset_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
    }


# ---------------------------------------------------------------------------
# Route 5: /api/defense-toggle  (GET & POST)
# ---------------------------------------------------------------------------
@app.get("/api/defense-toggle", tags=["Risk Agent"])
def get_defense_toggle():
    """Check current 24/7 AI Defense toggle state."""
    return {
        "ai_defense_enabled": ai_defense_enabled,
        "state_label": "ACTIVE" if ai_defense_enabled else "DISABLED",
    }


@app.post("/api/defense-toggle", tags=["Risk Agent"])
def set_defense_toggle(payload: dict = Body(default=None)):
    """
    Toggle or explicitly set the 24/7 AI Defense switch.
    Accepts: {"active": true | false}
    """
    global ai_defense_enabled
    if payload and "active" in payload:
        ai_defense_enabled = bool(payload["active"])
    else:
        ai_defense_enabled = not ai_defense_enabled

    return {
        "status": "success",
        "ai_defense_enabled": ai_defense_enabled,
        "state_label": "ACTIVE" if ai_defense_enabled else "DISABLED",
        "message": f"24/7 AI Defense toggle is now {'ACTIVE' if ai_defense_enabled else 'DISABLED'}.",
    }


# ---------------------------------------------------------------------------
# Route 6: /api/holdings  (GET & POST) — SQLite portfolio.db
# ---------------------------------------------------------------------------
@app.get("/api/holdings", tags=["Portfolio"])
def get_holdings():
    """
    Fetches all holdings from SQLite portfolio.db 'Holdings' table (Symbol, Quantity, Avg_Price),
    augments with live metadata, current valuation, and stop-loss protection metrics.
    """
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("SELECT Symbol, Quantity, Avg_Price FROM Holdings ORDER BY Symbol ASC")
    rows = cursor.fetchall()
    conn.close()

    holdings_list = []
    total_invested_usd = 0.0
    total_value_usd = 0.0

    for symbol, quantity, avg_price in rows:
        meta = STOCK_METADATA.get(symbol, {
            "name": f"{symbol} Holding",
            "sector": "Equity",
            "simulated_price": avg_price * 1.02,
            "daily_change_pct": 0.5,
            "icon": "📈",
            "safe_haven_pair": "GLD",
            "protection_tier": "Standard",
        })

        current_price = meta["simulated_price"]
        total_cost = quantity * avg_price
        current_value = quantity * current_price
        unrealized_pnl = current_value - total_cost
        unrealized_pnl_pct = ((current_price - avg_price) / avg_price) * 100 if avg_price > 0 else 0.0
        stop_loss_trigger = avg_price * 0.95  # 5% trailing protective floor

        total_invested_usd += total_cost
        total_value_usd += current_value

        holdings_list.append({
            "symbol": symbol,
            "name": meta["name"],
            "sector": meta["sector"],
            "icon": meta["icon"],
            "quantity": quantity,
            "avg_price_usd": round(avg_price, 2),
            "current_price_usd": round(current_price, 2),
            "total_cost_usd": round(total_cost, 2),
            "current_value_usd": round(current_value, 2),
            "unrealized_pnl_usd": round(unrealized_pnl, 2),
            "unrealized_pnl_pct": round(unrealized_pnl_pct, 2),
            "stop_loss_trigger_usd": round(stop_loss_trigger, 2),
            "safe_haven_pair": meta["safe_haven_pair"],
            "protection_tier": meta["protection_tier"],
            "daily_change_pct": meta["daily_change_pct"],
            "protection_status": "PROTECTED" if ai_defense_enabled else "STANDBY",
        })

    total_pnl_usd = total_value_usd - total_invested_usd
    total_pnl_pct = ((total_value_usd - total_invested_usd) / total_invested_usd * 100) if total_invested_usd > 0 else 0.0

    return {
        "status": "success",
        "holdings": holdings_list,
        "summary": {
            "holdings_count": len(holdings_list),
            "total_invested_usd": round(total_invested_usd, 2),
            "total_value_usd": round(total_value_usd, 2),
            "total_pnl_usd": round(total_pnl_usd, 2),
            "total_pnl_pct": round(total_pnl_pct, 2),
            "ai_defense_enabled": ai_defense_enabled,
        },
    }


@app.get("/api/holdings/{symbol}", tags=["Portfolio"])
def get_holding_detail(symbol: str):
    """Fetches single holding details from SQLite."""
    symbol = symbol.upper()
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("SELECT Symbol, Quantity, Avg_Price FROM Holdings WHERE Symbol = ?", (symbol,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail=f"Holding '{symbol}' not found in portfolio.db")

    sym, quantity, avg_price = row
    meta = STOCK_METADATA.get(sym, {
        "name": f"{sym} Corporation",
        "sector": "Equity",
        "simulated_price": avg_price * 1.02,
        "daily_change_pct": 1.1,
        "icon": "📈",
        "safe_haven_pair": "GLD",
        "protection_tier": "Standard",
    })

    current_price = meta["simulated_price"]
    total_cost = quantity * avg_price
    current_value = quantity * current_price
    unrealized_pnl = current_value - total_cost
    unrealized_pnl_pct = ((current_price - avg_price) / avg_price) * 100 if avg_price > 0 else 0.0
    stop_loss_trigger = avg_price * 0.95

    return {
        "status": "success",
        "holding": {
            "symbol": sym,
            "name": meta["name"],
            "sector": meta["sector"],
            "icon": meta["icon"],
            "quantity": quantity,
            "avg_price_usd": round(avg_price, 2),
            "current_price_usd": round(current_price, 2),
            "total_cost_usd": round(total_cost, 2),
            "current_value_usd": round(current_value, 2),
            "unrealized_pnl_usd": round(unrealized_pnl, 2),
            "unrealized_pnl_pct": round(unrealized_pnl_pct, 2),
            "stop_loss_trigger_usd": round(stop_loss_trigger, 2),
            "safe_haven_pair": meta["safe_haven_pair"],
            "protection_tier": meta["protection_tier"],
            "daily_change_pct": meta["daily_change_pct"],
        },
    }


@app.post("/api/holdings", tags=["Portfolio"])
def add_or_update_holding(payload: dict = Body(...)):
    """
    Creates or updates a holding in SQLite portfolio.db 'Holdings' table (Symbol, Quantity, Avg_Price).
    """
    symbol = payload.get("symbol", "").strip().upper()
    try:
        quantity = float(payload.get("quantity", 0))
        avg_price = float(payload.get("avg_price", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid quantity or avg_price.")

    if not symbol or quantity <= 0 or avg_price <= 0:
        raise HTTPException(
            status_code=400,
            detail="Must provide valid 'symbol' string, 'quantity' > 0, and 'avg_price' > 0."
        )

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO Holdings (Symbol, Quantity, Avg_Price)
        VALUES (?, ?, ?)
        ON CONFLICT(Symbol) DO UPDATE SET
            Quantity = excluded.Quantity,
            Avg_Price = excluded.Avg_Price
    """, (symbol, quantity, avg_price))
    conn.commit()
    conn.close()

    return {
        "status": "success",
        "message": f"Holding {symbol} ({quantity} shares @ ${avg_price:.2f}) saved to portfolio.db.",
        "symbol": symbol,
        "quantity": quantity,
        "avg_price": avg_price,
    }


@app.delete("/api/holdings/{symbol}", tags=["Portfolio"])
def delete_holding(symbol: str):
    """Deletes a holding from SQLite portfolio.db."""
    sym = symbol.strip().upper()
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("DELETE FROM Holdings WHERE Symbol = ?", (sym,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()

    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Holding '{sym}' not found in portfolio.db")

    return {"status": "success", "message": f"Holding {sym} removed from portfolio.db"}


@app.post("/api/holdings/reset", tags=["Portfolio"])
def reset_default_holdings():
    """Resets portfolio.db 'Holdings' table to standard Datathon seed portfolio."""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("DELETE FROM Holdings")
    seed_holdings = [
        ("AAPL", 15.0, 168.50),
        ("NVDA", 12.0, 118.25),
        ("MSFT", 8.0, 412.30),
        ("TSLA", 10.0, 215.40),
        ("AMZN", 14.0, 178.60),
        ("GOOGL", 10.0, 155.80),
    ]
    cursor.executemany("INSERT INTO Holdings (Symbol, Quantity, Avg_Price) VALUES (?, ?, ?)", seed_holdings)
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Portfolio holdings reset to default seed data."}


# ---------------------------------------------------------------------------
# Route 7: /api/safe-havens  (GET)
# ---------------------------------------------------------------------------
@app.get("/api/safe-havens", tags=["Risk Agent"])
def get_safe_havens():
    """Returns defensive safe haven asset recommendations for market crashes."""
    return {
        "status": "success",
        "safe_havens": SAFE_HAVEN_ASSETS,
        "rebalancing_policy": (
            "During HIGH THREAT sentiment events, RiskGuard AI recommends routing up to 35% "
            "of defensive liquidation proceeds into negative-beta safe havens (GLD, TLT, SHV)."
        ),
    }


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
