ALTER TABLE "domain_summaries" ADD COLUMN "domain_rating" real;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD COLUMN "referring_domains" integer;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD COLUMN "backlinks" integer;--> statement-breakpoint
ALTER TABLE "domain_summaries" ADD COLUMN "has_authority_data" boolean;--> statement-breakpoint
CREATE INDEX "domain_summaries_domain_rating_idx" ON "domain_summaries" USING btree ("domain_rating");