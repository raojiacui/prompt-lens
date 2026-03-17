CREATE TABLE "audio_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_url" text NOT NULL,
	"media_name" text,
	"language" varchar(10),
	"transcription" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration" integer,
	"whisper_model" varchar(20) DEFAULT 'small',
	"prompt" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_clip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_media_url" text NOT NULL,
	"source_media_name" text,
	"clip_media_url" text,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_analysis" ADD CONSTRAINT "audio_analysis_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_clip" ADD CONSTRAINT "video_clip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audio_analysis_user_id" ON "audio_analysis" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audio_analysis_created_at" ON "audio_analysis" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audio_analysis_status" ON "audio_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_video_clip_user_id" ON "video_clip" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_video_clip_created_at" ON "video_clip" USING btree ("created_at");