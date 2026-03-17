CREATE TYPE "public"."analyze_mode" AS ENUM('single', 'batch');--> statement-breakpoint
CREATE TYPE "public"."api_provider" AS ENUM('zhipu', 'gemini', 'openrouter');--> statement-breakpoint
CREATE TYPE "public"."log_action" AS ENUM('user.login', 'user.logout', 'file.upload', 'file.delete', 'analysis.start', 'analysis.complete', 'analysis.error', 'history.create', 'history.update', 'history.delete', 'settings.update', 'admin.user_ban', 'admin.user_unban');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('video', 'image');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_type" "media_type" NOT NULL,
	"media_url" text,
	"media_name" text,
	"frame_count" integer,
	"analyze_mode" "analyze_mode" DEFAULT 'single',
	"prompt" text NOT NULL,
	"core_prompt" text,
	"note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" "log_action" NOT NULL,
	"resource_type" varchar(50),
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "api_provider" NOT NULL,
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_history" ADD CONSTRAINT "analysis_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analysis_history_user_id" ON "analysis_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_history_created_at" ON "analysis_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_analysis_history_favorite" ON "analysis_history" USING btree ("favorite");--> statement-breakpoint
CREATE INDEX "idx_operation_logs_user_id" ON "operation_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_operation_logs_action" ON "operation_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_operation_logs_created_at" ON "operation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_user_api_keys_user_id" ON "user_api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_api_keys_provider" ON "user_api_keys" USING btree ("provider");