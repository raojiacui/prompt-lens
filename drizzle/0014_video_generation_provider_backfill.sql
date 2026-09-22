ALTER TABLE "video_generation" ADD COLUMN IF NOT EXISTS "provider" varchar(20) DEFAULT 'kie' NOT NULL;
