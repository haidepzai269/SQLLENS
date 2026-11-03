CREATE TABLE users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL,
    email        text,
    avatar_url   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
    provider   text NOT NULL CHECK (provider IN ('google', 'github')),
    subject    text NOT NULL CHECK (subject <> ''),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user_id_idx ON identities (user_id);

-- token_hash là SHA-256 của token phiên, không bao giờ lưu token gốc.
CREATE TABLE sessions (
    token_hash   bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
