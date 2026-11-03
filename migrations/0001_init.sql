CREATE TABLE users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- sha-256(token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',  -- JSON array of elements
  thumbnail TEXT,                   -- small data URL
  share TEXT NOT NULL DEFAULT 'private', -- private | view | edit
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX boards_owner ON boards(owner_id, updated_at DESC);

CREATE TABLE board_visits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, board_id)
);
CREATE INDEX visits_user ON board_visits(user_id, visited_at DESC);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX assets_board ON assets(board_id);
