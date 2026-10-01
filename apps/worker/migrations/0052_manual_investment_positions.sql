CREATE TABLE manual_investment_positions (
  id TEXT NOT NULL PRIMARY KEY,
  broker TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'JP')),
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'etf')),
  quantity REAL NOT NULL,
  currency TEXT NOT NULL,
  manual_price REAL,
  manual_price_date TEXT,
  quote_price REAL,
  quote_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (broker, market, symbol)
);
