ALTER TABLE "domain_summaries" ADD COLUMN "traffic_visits_total" real;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD COLUMN "traffic_visits_last_month" real;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD COLUMN "traffic_trend_ratio" real;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD COLUMN "has_traffic_data" boolean;--> statement-breakpoint
CREATE INDEX "domain_summaries_traffic_idx" ON "domain_summaries" USING btree ("traffic_visits_total");
