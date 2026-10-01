CREATE TABLE manual_investment_positions_new (
  id TEXT NOT NULL PRIMARY KEY,
  broker TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'JP', 'UK')),
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

INSERT INTO manual_investment_positions_new
SELECT id, broker, market, symbol, name, asset_type, quantity, currency,
  manual_price, manual_price_date, quote_price, quote_at, note, created_at, updated_at
FROM manual_investment_positions;

DROP TABLE manual_investment_positions;

ALTER TABLE manual_investment_positions_new RENAME TO manual_investment_positions;
