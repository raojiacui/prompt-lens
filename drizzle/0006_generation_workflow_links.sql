ALTER TABLE "video_generation" ADD COLUMN "project_id" uuid;
ALTER TABLE "video_generation" ADD COLUMN "scene_id" uuid;
ALTER TABLE "video_generation" ADD COLUMN "project_version_id" uuid;

ALTER TABLE "video_generation" ADD CONSTRAINT "video_generation_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE set null;
ALTER TABLE "video_generation" ADD CONSTRAINT "video_generation_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "video_scenes"("id") ON DELETE set null;
ALTER TABLE "video_generation" ADD CONSTRAINT "video_generation_project_version_id_project_versions_id_fk" FOREIGN KEY ("project_version_id") REFERENCES "project_versions"("id") ON DELETE set null;

CREATE INDEX "idx_video_generation_project_id" ON "video_generation" ("project_id");
CREATE INDEX "idx_video_generation_scene_id" ON "video_generation" ("scene_id");
CREATE INDEX "idx_video_generation_project_version_id" ON "video_generation" ("project_version_id");
CREATE INDEX "idx_workflow_jobs_external_task_id" ON "workflow_jobs" ("external_task_id");
