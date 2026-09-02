CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "source_batch_domains" (
	"source_batch_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"raw_value" text NOT NULL,
	"position" integer NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_batch_domains_source_batch_id_domain_id_pk" PRIMARY KEY("source_batch_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "source_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"external_reference" text,
	"name" text,
	"status" text DEFAULT 'ingesting' NOT NULL,
	"content_sha256" text NOT NULL,
	"artifact_key" text,
	"etag" text,
	"last_modified" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"domain_count" integer DEFAULT 0 NOT NULL,
	"new_domain_count" integer DEFAULT 0 NOT NULL,
	"invalid_line_count" integer DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "domain_blacklist" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_blacklist_pattern_unique" UNIQUE("pattern")
);
--> statement-breakpoint
CREATE TABLE "domain_dispositions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"disposition" text,
	"note" text,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_summaries" (
	"domain_id" uuid PRIMARY KEY NOT NULL,
	"latest_run_id" uuid,
	"latest_run_status" text,
	"latest_run_at" timestamp with time zone,
	"latest_completed_run_id" uuid,
	"disposition" text,
	"manual_disposition" text,
	"overall_score" real,
	"confidence_score" real,
	"name_score" real,
	"brand_score" real,
	"seo_score" real,
	"link_score" real,
	"history_score" real,
	"commercial_score" real,
	"risk_score" real,
	"acquisition_score" real,
	"digit_count" integer,
	"hyphen_count" integer,
	"fqdn_length" integer,
	"dns_resolves" boolean,
	"http_status" integer,
	"has_seo_data" boolean,
	"candidate_gate_passed" boolean,
	"shortlist_count" integer DEFAULT 0 NOT NULL,
	"source_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"tag_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_tags" (
	"domain_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_by" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_tags_domain_id_tag_id_pk" PRIMARY KEY("domain_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fqdn" text NOT NULL,
	"ascii_fqdn" text NOT NULL,
	"unicode_fqdn" text NOT NULL,
	"sld" text NOT NULL,
	"tld" text NOT NULL,
	"registrable_domain" text NOT NULL,
	"normalization_version" integer NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_reference" text,
	"pipeline_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"force_deep" boolean DEFAULT false NOT NULL,
	"force_refresh" boolean DEFAULT false NOT NULL,
	"requested_by" uuid,
	"source_batch_id" uuid,
	"ruleset_id" uuid,
	"score_model_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"error_message_sanitized" text,
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"provider_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_code" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"analysis_run_id" uuid,
	"provider_key" text NOT NULL,
	"metric_key" text NOT NULL,
	"value_type" text NOT NULL,
	"value_numeric" double precision,
	"value_text" text,
	"value_boolean" boolean,
	"value_json" jsonb,
	"state" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"confidence_numeric" double precision,
	"raw_evidence_key" text,
	"license_class" text DEFAULT 'internal' NOT NULL,
	"purged_at" timestamp with time zone,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"analysis_run_id" uuid,
	"domain_id" uuid,
	"endpoint_key" text NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"units_used" double precision,
	"estimated_cost_usd" double precision,
	"status_code" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"cached" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"capabilities" text[] NOT NULL,
	"rate_limit_rps" real DEFAULT 10 NOT NULL,
	"concurrency_limit" integer DEFAULT 10 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"default_ttl_hours" real DEFAULT 24 NOT NULL,
	"retention_policy" text DEFAULT 'internal' NOT NULL,
	"monthly_unit_budget" integer,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"ruleset_version" integer NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"matched" boolean NOT NULL,
	"action" text,
	"reason_code" text NOT NULL,
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"condition_json" jsonb NOT NULL,
	"action_json" jsonb NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulesets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"created_by" uuid,
	"cloned_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"score_model_id" uuid NOT NULL,
	"score_model_version" integer NOT NULL,
	"name_score" real,
	"brand_score" real,
	"seo_score" real,
	"link_score" real,
	"history_score" real,
	"commercial_score" real,
	"risk_score" real,
	"acquisition_score" real,
	"confidence_score" real NOT NULL,
	"overall_score" real NOT NULL,
	"explanation_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"weights_json" jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crawler_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"fqdn" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortlist_domains" (
	"shortlist_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"analysis_run_id" uuid,
	"rank" integer,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shortlist_domains_shortlist_id_domain_id_pk" PRIMARY KEY("shortlist_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "shortlists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"target_type" text,
	"target_id" text,
	"ip_address" text,
	"request_id" text,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"component" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_batch_domains" ADD CONSTRAINT "source_batch_domains_source_batch_id_source_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."source_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_batch_domains" ADD CONSTRAINT "source_batch_domains_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_batches" ADD CONSTRAINT "source_batches_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_blacklist" ADD CONSTRAINT "domain_blacklist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_dispositions" ADD CONSTRAINT "domain_dispositions_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_dispositions" ADD CONSTRAINT "domain_dispositions_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_notes" ADD CONSTRAINT "domain_notes_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_notes" ADD CONSTRAINT "domain_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD CONSTRAINT "domain_summaries_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_tags" ADD CONSTRAINT "domain_tags_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_tags" ADD CONSTRAINT "domain_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_tags" ADD CONSTRAINT "domain_tags_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_steps" ADD CONSTRAINT "analysis_steps_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_observations" ADD CONSTRAINT "domain_observations_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_observations" ADD CONSTRAINT "domain_observations_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_scores" ADD CONSTRAINT "domain_scores_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_scores" ADD CONSTRAINT "domain_scores_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_scores" ADD CONSTRAINT "domain_scores_score_model_id_score_models_id_fk" FOREIGN KEY ("score_model_id") REFERENCES "public"."score_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawler_jobs" ADD CONSTRAINT "crawler_jobs_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawler_jobs" ADD CONSTRAINT "crawler_jobs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_domains" ADD CONSTRAINT "shortlist_domains_shortlist_id_shortlists_id_fk" FOREIGN KEY ("shortlist_id") REFERENCES "public"."shortlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_domains" ADD CONSTRAINT "shortlist_domains_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_domains" ADD CONSTRAINT "shortlist_domains_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_domains" ADD CONSTRAINT "shortlist_domains_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "source_batch_domains_domain_idx" ON "source_batch_domains" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_batches_source_sha_uidx" ON "source_batches" USING btree ("source_id","content_sha256");--> statement-breakpoint
CREATE INDEX "source_batches_detected_idx" ON "source_batches" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "domain_dispositions_domain_idx" ON "domain_dispositions" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_notes_domain_idx" ON "domain_notes" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "domain_summaries_overall_idx" ON "domain_summaries" USING btree ("overall_score");--> statement-breakpoint
CREATE INDEX "domain_summaries_confidence_idx" ON "domain_summaries" USING btree ("confidence_score");--> statement-breakpoint
CREATE INDEX "domain_summaries_status_idx" ON "domain_summaries" USING btree ("latest_run_status");--> statement-breakpoint
CREATE INDEX "domain_summaries_disposition_idx" ON "domain_summaries" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "domain_summaries_manual_idx" ON "domain_summaries" USING btree ("manual_disposition");--> statement-breakpoint
CREATE INDEX "domain_summaries_updated_idx" ON "domain_summaries" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "domain_tags_tag_idx" ON "domain_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_ascii_fqdn_uidx" ON "domains" USING btree ("ascii_fqdn");--> statement-breakpoint
CREATE INDEX "domains_tld_idx" ON "domains" USING btree ("tld");--> statement-breakpoint
CREATE INDEX "domains_sld_idx" ON "domains" USING btree ("sld");--> statement-breakpoint
CREATE INDEX "domains_first_seen_idx" ON "domains" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "domains_registrable_idx" ON "domains" USING btree ("registrable_domain");--> statement-breakpoint
CREATE INDEX "domains_ascii_fqdn_trgm_idx" ON "domains" USING gin ("ascii_fqdn" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "analysis_runs_domain_idx" ON "analysis_runs" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_runs_status_idx" ON "analysis_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "analysis_runs_batch_idx" ON "analysis_runs" USING btree ("source_batch_id");--> statement-breakpoint
CREATE INDEX "analysis_steps_run_idx" ON "analysis_steps" USING btree ("analysis_run_id","step_key");--> statement-breakpoint
CREATE INDEX "domain_observations_domain_metric_idx" ON "domain_observations" USING btree ("domain_id","metric_key","observed_at");--> statement-breakpoint
CREATE INDEX "domain_observations_provider_metric_idx" ON "domain_observations" USING btree ("provider_key","metric_key");--> statement-breakpoint
CREATE INDEX "domain_observations_expires_idx" ON "domain_observations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "domain_observations_run_idx" ON "domain_observations" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE INDEX "provider_requests_provider_started_idx" ON "provider_requests" USING btree ("provider_key","started_at");--> statement-breakpoint
CREATE INDEX "provider_requests_run_idx" ON "provider_requests" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE INDEX "provider_requests_domain_idx" ON "provider_requests" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "rule_executions_run_idx" ON "rule_executions" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE INDEX "rule_executions_domain_idx" ON "rule_executions" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_ruleset_key_uidx" ON "rules" USING btree ("ruleset_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "rulesets_scope_version_uidx" ON "rulesets" USING btree ("scope","version");--> statement-breakpoint
CREATE INDEX "rulesets_status_idx" ON "rulesets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_scores_run_uidx" ON "domain_scores" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE INDEX "domain_scores_domain_idx" ON "domain_scores" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_scores_overall_idx" ON "domain_scores" USING btree ("overall_score");--> statement-breakpoint
CREATE UNIQUE INDEX "score_models_version_uidx" ON "score_models" USING btree ("version");--> statement-breakpoint
CREATE INDEX "crawler_jobs_status_idx" ON "crawler_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "crawler_jobs_run_idx" ON "crawler_jobs" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE INDEX "crawler_jobs_lease_idx" ON "crawler_jobs" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "shortlist_domains_domain_idx" ON "shortlist_domains" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "operational_events_created_idx" ON "operational_events" USING btree ("created_at");