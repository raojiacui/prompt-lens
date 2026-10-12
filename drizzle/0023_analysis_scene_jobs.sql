CREATE TABLE IF NOT EXISTS analysis_scene_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES commercial_tasks(id) ON DELETE CASCADE,
  scene_id text NOT NULL,
  scene_index integer NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  execution_id uuid,
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_scene_job_unique UNIQUE (task_id, scene_id)
);
CREATE INDEX IF NOT EXISTS analysis_scene_job_state_idx ON analysis_scene_jobs (state, updated_at);
ALTER TABLE analysis_scene_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE analysis_scene_jobs FROM PUBLIC;
