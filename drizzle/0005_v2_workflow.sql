CREATE TYPE "project_status" AS ENUM ('draft', 'analyzing', 'ready', 'failed', 'archived');
CREATE TYPE "project_version_kind" AS ENUM ('original', 'remix');
CREATE TYPE "workflow_job_status" AS ENUM ('queued', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE "workflow_job_type" AS ENUM ('ANALYZE_VIDEO', 'SPLIT_VIDEO', 'ANALYZE_SCENE', 'GENERATE_VIDEO', 'GENERATE_AUDIO', 'RENDER_VIDEO', 'REMIX_VIDEO');
CREATE TYPE "project_asset_type" AS ENUM ('reference_video', 'scene_clip', 'keyframe', 'audio', 'generated_video', 'voice', 'subtitle', 'final_video', 'image', 'other');

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" "project_status" DEFAULT 'draft' NOT NULL,
  "active_version_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "project_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "parent_version_id" uuid,
  "version_number" integer NOT NULL,
  "kind" "project_version_kind" DEFAULT 'original' NOT NULL,
  "label" text NOT NULL,
  "remix_prompt" text,
  "overview" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reference_videos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "source_url" text NOT NULL,
  "storage_key" text,
  "file_name" text,
  "mime_type" text,
  "duration" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "video_scenes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "reference_video_id" uuid,
  "scene_index" integer NOT NULL,
  "shot_group_id" text,
  "start_time" double precision NOT NULL,
  "end_time" double precision NOT NULL,
  "duration" double precision NOT NULL,
  "clip_url" text,
  "keyframe_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "audio_url" text,
  "transition_in" text,
  "transition_out" text,
  "status" "workflow_job_status" DEFAULT 'queued' NOT NULL,
  "error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "scene_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "project_version_id" uuid NOT NULL,
  "original_scene_id" uuid NOT NULL,
  "scene_index" integer NOT NULL,
  "story" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "visual" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dialogue" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "narration" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subtitle" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "audio" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "transition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generation_prompt" text NOT NULL,
  "duration" double precision NOT NULL,
  "generated_video_url" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "workflow_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid,
  "scene_id" uuid,
  "type" "workflow_job_type" NOT NULL,
  "status" "workflow_job_status" DEFAULT 'queued' NOT NULL,
  "provider" text,
  "model_id" text,
  "external_task_id" text,
  "result_url" text,
  "error" text,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE TABLE "project_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid,
  "scene_id" uuid,
  "type" "project_asset_type" NOT NULL,
  "url" text NOT NULL,
  "storage_key" text,
  "file_name" text,
  "mime_type" text,
  "size" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
ALTER TABLE "reference_videos" ADD CONSTRAINT "reference_videos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_reference_video_id_reference_videos_id_fk" FOREIGN KEY ("reference_video_id") REFERENCES "reference_videos"("id") ON DELETE set null;
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_project_version_id_project_versions_id_fk" FOREIGN KEY ("project_version_id") REFERENCES "project_versions"("id") ON DELETE cascade;
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_original_scene_id_video_scenes_id_fk" FOREIGN KEY ("original_scene_id") REFERENCES "video_scenes"("id") ON DELETE cascade;
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "video_scenes"("id") ON DELETE set null;
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "video_scenes"("id") ON DELETE set null;

CREATE INDEX "idx_projects_user_id" ON "projects" ("user_id");
CREATE INDEX "idx_projects_status" ON "projects" ("status");
CREATE INDEX "idx_projects_created_at" ON "projects" ("created_at");
CREATE INDEX "idx_project_versions_project_id" ON "project_versions" ("project_id");
CREATE INDEX "idx_project_versions_kind" ON "project_versions" ("kind");
CREATE INDEX "idx_reference_videos_project_id" ON "reference_videos" ("project_id");
CREATE INDEX "idx_video_scenes_project_id" ON "video_scenes" ("project_id");
CREATE INDEX "idx_video_scenes_reference_video_id" ON "video_scenes" ("reference_video_id");
CREATE INDEX "idx_video_scenes_scene_index" ON "video_scenes" ("scene_index");
CREATE INDEX "idx_scene_versions_project_id" ON "scene_versions" ("project_id");
CREATE INDEX "idx_scene_versions_project_version_id" ON "scene_versions" ("project_version_id");
CREATE INDEX "idx_scene_versions_original_scene_id" ON "scene_versions" ("original_scene_id");
CREATE INDEX "idx_workflow_jobs_project_id" ON "workflow_jobs" ("project_id");
CREATE INDEX "idx_workflow_jobs_scene_id" ON "workflow_jobs" ("scene_id");
CREATE INDEX "idx_workflow_jobs_status" ON "workflow_jobs" ("status");
CREATE INDEX "idx_workflow_jobs_type" ON "workflow_jobs" ("type");
CREATE INDEX "idx_project_assets_project_id" ON "project_assets" ("project_id");
CREATE INDEX "idx_project_assets_scene_id" ON "project_assets" ("scene_id");
CREATE INDEX "idx_project_assets_type" ON "project_assets" ("type");