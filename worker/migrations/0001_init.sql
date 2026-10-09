-- Tokenscope D1 schema

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  telegram_chat_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- One current subscription per user. Renewals stack onto expires_at.
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  plan TEXT NOT NULL CHECK (plan IN ('pro','builder','alerts')),
  period_days INTEGER NOT NULL,
  paid_usd REAL NOT NULL,
  period_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reminder_sent_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX api_keys_user ON api_keys(user_id);

-- Pay-per-call credits. Never expire.
CREATE TABLE credits (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0
);

-- Usage counters. subject = 'ip:<addr>' (free) or 'user:<id>'; bucket = 'YYYY-MM-DD' or 'period:<start>'.
CREATE TABLE usage (
  subject TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, bucket)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  email TEXT,
  product TEXT NOT NULL,            -- JSON ProductRef
  chain TEXT NOT NULL CHECK (chain IN ('ethereum','solana')),
  price_usd REAL NOT NULL,          -- list price after proration
  amount_units TEXT NOT NULL,       -- exact USDC base units (6dp) expected
  amount_display TEXT NOT NULL,
  recipient TEXT NOT NULL,
  token TEXT NOT NULL,
  reference TEXT UNIQUE,            -- Solana Pay reference key
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirming','paid','expired')),
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  api_key_once TEXT                 -- plaintext key shown once after activation, then cleared
);
CREATE INDEX invoices_status ON invoices(status, chain);
CREATE INDEX invoices_amount ON invoices(chain, amount_units, status);

-- Ledger of every payment received (UK: crypto received for services is income; keep records).
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  payer TEXT,
  amount_units TEXT NOT NULL,
  usd_value REAL NOT NULL,
  block_ref TEXT,
  received_at INTEGER NOT NULL
);

CREATE TABLE watches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','discord','email')),
  target TEXT NOT NULL,             -- telegram chat id, discord webhook url, or email
  last_score INTEGER,
  last_level TEXT,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, chain, address, channel, target)
);
CREATE INDEX watches_checked ON watches(last_checked_at);

CREATE TABLE cursors (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
