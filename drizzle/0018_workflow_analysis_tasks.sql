ALTER TABLE commercial_tasks DROP CONSTRAINT commercial_tasks_kind_check;
--> statement-breakpoint
ALTER TABLE commercial_tasks ADD CONSTRAINT commercial_tasks_kind_check CHECK (kind IN ('analysis_preview', 'analysis', 'generation', 'workflow_analysis'));
--> statement-breakpoint
CREATE UNIQUE INDEX workflow_analysis_project_unique ON commercial_tasks (user_id, (input->>'projectId')) WHERE kind = 'workflow_analysis';
