ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audio_analysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_clip" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own data" ON "user";
CREATE POLICY "Users can view own data" ON "user" FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own data" ON "user";
CREATE POLICY "Users can update own data" ON "user" FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can use own session" ON "session";
CREATE POLICY "Users can use own session" ON "session" FOR ALL USING (auth.uid() = userId);

DROP POLICY IF EXISTS "Users can manage own account" ON "account";
CREATE POLICY "Users can manage own account" ON "account" FOR ALL USING (auth.uid() = userId);

DROP POLICY IF EXISTS "Verification system only" ON "verification";
CREATE POLICY "Verification system only" ON "verification" FOR ALL USING (true);

DROP POLICY IF EXISTS "Users can manage own api keys" ON "user_api_keys";
CREATE POLICY "Users can manage own api keys" ON "user_api_keys" FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own history" ON "analysis_history";
CREATE POLICY "Users can manage own history" ON "analysis_history" FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own logs" ON "operation_logs";
CREATE POLICY "Users can view own logs" ON "operation_logs" FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all logs" ON "operation_logs";
CREATE POLICY "Admins can view all logs" ON "operation_logs" FOR SELECT USING (EXISTS (SELECT 1 FROM "user" WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can view all users" ON "user";
CREATE POLICY "Admins can view all users" ON "user" FOR SELECT USING (EXISTS (SELECT 1 FROM "user" WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can view all accounts" ON "account";
CREATE POLICY "Admins can view all accounts" ON "account" FOR SELECT USING (EXISTS (SELECT 1 FROM "user" WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can manage own audio analysis" ON "audio_analysis";
CREATE POLICY "Users can manage own audio analysis" ON "audio_analysis" FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own video clips" ON "video_clip";
CREATE POLICY "Users can manage own video clips" ON "video_clip" FOR ALL USING (auth.uid() = user_id);
