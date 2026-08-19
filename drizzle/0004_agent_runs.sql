CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'planning', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_step_status" AS ENUM('queued', 'running', 'completed', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_tool_call_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_artifact_type" AS ENUM('brief', 'research_report', 'video_prompt', 'shot_list', 'workflow', 'risk_notes', 'next_actions', 'history_lookup', 'summary', 'other');--> statement-breakpoint
CREATE TYPE "public"."agent_task_kind" AS ENUM('trend_research', 'video_analysis', 'video_prompt_generation', 'product_launch_video', 'competitor_breakdown', 'generic');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"task_kind" "agent_task_kind",
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" "agent_step_status" DEFAULT 'queued' NOT NULL,
	"tool_name" text,
	"expected_output" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"output_summary" text
);--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"status" "agent_tool_call_status" DEFAULT 'running' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text
);--> statement-breakpoint
CREATE TABLE "agent_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" "agent_artifact_type" NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_step_id_agent_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_runs_user_id" ON "agent_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_status" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_created_at" ON "agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_steps_run_id" ON "agent_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_agent_steps_order" ON "agent_steps" USING btree ("order");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_calls_run_id" ON "agent_tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_calls_step_id" ON "agent_tool_calls" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "idx_agent_artifacts_run_id" ON "agent_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_agent_artifacts_type" ON "agent_artifacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_agent_artifacts_favorite" ON "agent_artifacts" USING btree ("favorite");
