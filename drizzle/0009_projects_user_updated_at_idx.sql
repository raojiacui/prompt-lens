CREATE INDEX IF NOT EXISTS "idx_projects_user_id_updated_at" ON "projects" ("user_id", "updated_at" DESC);
