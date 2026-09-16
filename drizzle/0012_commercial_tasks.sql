CREATE TABLE commercial_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES "user"(id),
  kind varchar(24) NOT NULL CHECK (kind IN ('analysis_preview', 'analysis', 'generation')),
  state varchar(24) NOT NULL DEFAULT 'quoted' CHECK (state IN ('quoted','queued','running','completed','failed','review')),
  input jsonb NOT NULL, result jsonb NOT NULL DEFAULT '{}',
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  provider_task_id text, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_task_user_idx ON commercial_tasks(user_id);
CREATE INDEX commercial_task_state_idx ON commercial_tasks(state);
--> statement-breakpoint
ALTER TABLE video_generation ADD COLUMN IF NOT EXISTS provider varchar(20) NOT NULL DEFAULT 'kie';
