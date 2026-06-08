CREATE TABLE "video_generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"duration" integer,
	"resolution" varchar(20),
	"model" varchar(100),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"progress" varchar(50),
	"video_url" text,
	"error" text,
	"raw_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_generation_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "video_generation" ADD CONSTRAINT "video_generation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_video_generation_user_id" ON "video_generation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_video_generation_task_id" ON "video_generation" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_video_generation_status" ON "video_generation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_video_generation_created_at" ON "video_generation" USING btree ("created_at");
