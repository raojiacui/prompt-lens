CREATE TABLE IF NOT EXISTS analysis_provider_slots (
  scene_job_id uuid PRIMARY KEY REFERENCES analysis_scene_jobs(id) ON DELETE CASCADE,
  key_fingerprint varchar(64) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NOT NULL,
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS analysis_provider_slots_key_idx ON analysis_provider_slots (key_fingerprint, started_at);
ALTER TABLE analysis_provider_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE analysis_provider_slots FROM PUBLIC;
