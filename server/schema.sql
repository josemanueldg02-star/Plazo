-- Esquema PostgreSQL para escalar a varias instancias (sustituye a FileStore).
-- Diseño: la base de datos tampoco contiene nada legible. Si se filtra, el atacante
-- obtiene hashes scrypt de claves derivadas con PBKDF2 y bloques AES-256-GCM.

CREATE TABLE accounts (
  id              uuid PRIMARY KEY,
  kdf_alg         text        NOT NULL CHECK (kdf_alg = 'PBKDF2-SHA256'),
  kdf_iter        integer     NOT NULL CHECK (kdf_iter >= 600000),
  kdf_salt        text        NOT NULL,
  auth_salt       text        NOT NULL,
  auth_hash       text        NOT NULL,
  plan            text        NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus')),
  plan_expires_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vaults (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version    integer     NOT NULL CHECK (version > 0),
  blob       text        NOT NULL CHECK (octet_length(blob) <= 6291456),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Solo se guarda el SHA-256 del token, nunca el token.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_account_idx ON sessions(account_id, created_at);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

-- Compare-and-set de la bóveda (equivale a MemoryStore.putVault):
--   UPDATE vaults SET version = version + 1, blob = $3, updated_at = now()
--   WHERE account_id = $1 AND version = $2;
-- 0 filas afectadas = conflicto (409).

-- Usuario de la aplicación con privilegios mínimos (sin DDL, sin superusuario):
--   CREATE ROLE plazo_app LOGIN PASSWORD '...';   -- la contraseña va en .env, nunca aquí
--   GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, vaults, sessions TO plazo_app;
