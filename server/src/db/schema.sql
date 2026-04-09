-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- World map metadata
CREATE TABLE IF NOT EXISTS world (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    width       INT NOT NULL,
    height      INT NOT NULL,
    tile_data   JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Activity locations on the map
CREATE TABLE IF NOT EXISTS activities (
    id          SERIAL PRIMARY KEY,
    world_id    INT REFERENCES world(id),
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    x           INT NOT NULL,
    y           INT NOT NULL,
    capacity    INT DEFAULT 1,
    emoji       TEXT DEFAULT '📍'
);

-- Players (both human and NPC)
CREATE TABLE IF NOT EXISTS players (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    personality     TEXT,
    is_npc          BOOLEAN DEFAULT FALSE,
    x               FLOAT NOT NULL DEFAULT 0,
    y               FLOAT NOT NULL DEFAULT 0,
    target_x        FLOAT,
    target_y        FLOAT,
    orientation     TEXT DEFAULT 'down',
    speed           FLOAT DEFAULT 1.0,
    state           TEXT DEFAULT 'idle',
    current_activity_id INT REFERENCES activities(id),
    current_convo_id    INT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations between two players
CREATE TABLE IF NOT EXISTS conversations (
    id          SERIAL PRIMARY KEY,
    player1_id  TEXT REFERENCES players(id),
    player2_id  TEXT REFERENCES players(id),
    state       TEXT DEFAULT 'invited',
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    ended_at    TIMESTAMPTZ,
    summary     TEXT
);

-- Add FK from players to conversations (after conversations table exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_players_current_convo'
    ) THEN
        ALTER TABLE players
            ADD CONSTRAINT fk_players_current_convo
            FOREIGN KEY (current_convo_id) REFERENCES conversations(id);
    END IF;
END $$;

-- Individual messages within a conversation
CREATE TABLE IF NOT EXISTS messages (
    id          SERIAL PRIMARY KEY,
    convo_id    INT REFERENCES conversations(id),
    player_id   TEXT REFERENCES players(id),
    content     TEXT NOT NULL,
    tick        INT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- NPC memories (observations, reflections, conversations)
CREATE TABLE IF NOT EXISTS memories (
    id                  SERIAL PRIMARY KEY,
    player_id           TEXT REFERENCES players(id),
    type                TEXT NOT NULL,
    content             TEXT NOT NULL,
    importance          INT DEFAULT 5,
    embedding           vector(1536),
    related_ids         INT[],
    tick                INT NOT NULL,
    last_accessed_tick  INT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_memories_embedding
    ON memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Index for querying memories by player
CREATE INDEX IF NOT EXISTS idx_memories_player_tick
    ON memories (player_id, tick DESC);

-- LLM replies and reflections for NPC debugging/auditing.
-- Write-only audit trail: rows are inserted by npcStore.addGeneration()
-- but never queried at runtime. Useful for offline analysis of NPC
-- behavior, prompt quality, and latency.
CREATE TABLE IF NOT EXISTS llm_generations (
    id              SERIAL PRIMARY KEY,
    convo_id        INT REFERENCES conversations(id),
    player_id       TEXT REFERENCES players(id),
    kind            TEXT NOT NULL,
    provider        TEXT NOT NULL,
    session_id      TEXT,
    prompt          TEXT NOT NULL,
    response        TEXT,
    latency_ms      INT,
    error           TEXT,
    tick            INT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_generations_convo
    ON llm_generations (convo_id, created_at DESC);

-- Snapshot of NPC debug state at time of death. Used to keep dead NPCs visible
-- in the debug dashboard and survive server restarts.
CREATE TABLE IF NOT EXISTS dead_npcs (
    npc_id       TEXT PRIMARY KEY,
    died_at_tick INT NOT NULL,
    snapshot     JSONB NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_npcs_died_at_tick
    ON dead_npcs (died_at_tick DESC);

-- Game log for debugging
CREATE TABLE IF NOT EXISTS game_log (
    id          SERIAL PRIMARY KEY,
    tick        INT NOT NULL,
    event_type  TEXT NOT NULL,
    player_id   TEXT,
    data        JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_log_tick
    ON game_log (tick DESC);

CREATE INDEX IF NOT EXISTS idx_game_log_player_tick
    ON game_log (player_id, tick DESC);
