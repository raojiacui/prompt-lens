-- Apply only to the explicitly authorized target database; see ADR 0069 and 0072.
CREATE TABLE IF NOT EXISTS "moderation_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "phrase" varchar(160) NOT NULL,
  "normalized_phrase" varchar(160) NOT NULL,
  "category" varchar(32) NOT NULL,
  "action" varchar(12) NOT NULL DEFAULT 'review',
  "enabled" boolean NOT NULL DEFAULT true,
  "revision" integer NOT NULL DEFAULT 1,
  "note" varchar(500),
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "moderation_terms_action_check" CHECK ("action" IN ('block','review'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "moderation_terms_normalized_unique" ON "moderation_terms" ("normalized_phrase");
CREATE INDEX IF NOT EXISTS "moderation_terms_enabled_idx" ON "moderation_terms" ("enabled","category");
CREATE TABLE IF NOT EXISTS "moderation_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_key" varchar(180) UNIQUE,
  "user_id" uuid,
  "task_id" varchar(180),
  "stage" varchar(24) NOT NULL,
  "provider" varchar(40) NOT NULL,
  "verdict" varchar(24) NOT NULL,
  "category" varchar(32),
  "rule_id" uuid,
  "reason_code" varchar(64),
  "reference_hash" varchar(64),
  "provider_request_id" varchar(128),
  "reviewer_id" uuid,
  "related_record_id" uuid,
  "review_note" varchar(1500),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "moderation_records_recent_idx" ON "moderation_records" ("created_at");
CREATE INDEX IF NOT EXISTS "moderation_records_task_idx" ON "moderation_records" ("task_id","created_at");
CREATE INDEX IF NOT EXISTS "moderation_records_verdict_idx" ON "moderation_records" ("verdict","created_at");

-- Server-only tables: the application connects with its privileged database role.
-- Do not expose policy management or review metadata through the Supabase Data API.
ALTER TABLE "moderation_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moderation_records" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "moderation_terms", "moderation_records" FROM PUBLIC, anon, authenticated;

-- Seed a baseline only for the isolated test database. All entries are editable;
-- maintainers must review and update them in the admin interface.
INSERT INTO "moderation_terms" ("phrase","normalized_phrase","category","action","note")
VALUES
 ('一键脱衣','一键脱衣','deepfake','block','Real-person nudification requests'),
 ('deep nude','deep nude','deepfake','block','Real-person nudification requests'),
 ('face swap','face swap','deepfake','review','Potential identity substitution; require contextual review'),
 ('换脸','换脸','deepfake','review','Potential identity substitution; require contextual review'),
 ('儿童色情','儿童色情','child_safety','block','Child sexual exploitation'),
 ('未成年人色情','未成年人色情','child_safety','block','Child sexual exploitation'),
 ('血腥虐杀','血腥虐杀','violence','review','Violence / gore'),
 ('仇恨煽动','仇恨煽动','hate','review','Hate incitement'),
 ('自杀教程','自杀教程','self_harm','review','Self harm instruction'),
 ('无授权复制角色','无授权复制角色','ip','review','Potential copyright infringement'),
 ('冒充政治人物','冒充政治人物','public_figures','review','Potential misleading impersonation')
ON CONFLICT ("normalized_phrase") DO NOTHING;
