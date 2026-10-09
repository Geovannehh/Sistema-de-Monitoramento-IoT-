CREATE TABLE IF NOT EXISTS devices (
 id text PRIMARY KEY,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS telemetry (
 id uuid NOT NULL,
 device_id text NOT NULL REFERENCES devices(id),
 recorded_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 metrics jsonb NOT NULL,
 PRIMARY KEY (device_id,id)
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_recorded ON telemetry(device_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS device_logs (
 id text NOT NULL,
 device_id text NOT NULL REFERENCES devices(id),
 level text NOT NULL CHECK (level IN ('INFO','WARN','ERROR')),
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (device_id,id)
);
CREATE INDEX IF NOT EXISTS idx_device_logs_created ON device_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS commands (
 id uuid PRIMARY KEY,
 device_id text NOT NULL REFERENCES devices(id),
 name text NOT NULL CHECK (name IN ('RESTART','UPDATE_CONFIG','ENABLE_SENSOR')),
 params jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('QUEUED','SENT','ACKNOWLEDGED','FAILED','EXPIRED')),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 sent_at timestamptz,
 completed_at timestamptz,
 message text,
 operator text NOT NULL,
 attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_commands_pending ON commands(created_at) WHERE status IN ('QUEUED','SENT');
