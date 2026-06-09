CREATE TABLE "daily_engagement" (
	"date" date PRIMARY KEY NOT NULL,
	"impressions" integer NOT NULL,
	"engagements" integer NOT NULL,
	"day_of_week" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"posts_captured" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_demographics" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"category" text NOT NULL,
	"value" text NOT NULL,
	"pct" numeric(6, 2) NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"kind" text NOT NULL,
	"blob_url" text,
	"source_url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"members_reached" integer DEFAULT 0 NOT NULL,
	"social_engagements" integer DEFAULT 0 NOT NULL,
	"reactions_total" integer DEFAULT 0 NOT NULL,
	"reactions_like" integer,
	"reactions_celebrate" integer,
	"reactions_support" integer,
	"reactions_love" integer,
	"reactions_insightful" integer,
	"reactions_funny" integer,
	"comments" integer DEFAULT 0 NOT NULL,
	"reposts" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer,
	"profile_viewers" integer DEFAULT 0 NOT NULL,
	"followers_gained" integer DEFAULT 0 NOT NULL,
	"engagement_rate" numeric(8, 4),
	"data_source" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"activity_id" text PRIMARY KEY NOT NULL,
	"post_content" text NOT NULL,
	"post_url" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"topic" text,
	"style" text,
	"image_type" text,
	"word_count" integer,
	"paragraph_count" integer,
	"has_link" boolean DEFAULT false NOT NULL,
	"has_image" boolean DEFAULT false NOT NULL,
	"has_bold_unicode" boolean DEFAULT false NOT NULL,
	"has_emoji" boolean DEFAULT false NOT NULL,
	"has_bullet_points" boolean DEFAULT false NOT NULL,
	"has_question" boolean DEFAULT false NOT NULL,
	"feature_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"total_followers" integer NOT NULL,
	"follower_growth_12mo" integer,
	"total_impressions_12mo" integer,
	"total_engagements_12mo" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_snapshots_snapshot_date_unique" UNIQUE("snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "post_demographics" ADD CONSTRAINT "post_demographics_activity_id_posts_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."posts"("activity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_activity_id_posts_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."posts"("activity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_snapshots" ADD CONSTRAINT "post_snapshots_activity_id_posts_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."posts"("activity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_demographics_unique" ON "post_demographics" USING btree ("activity_id","snapshot_date","category","value");--> statement-breakpoint
CREATE INDEX "post_media_post_idx" ON "post_media" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_snapshots_post_day_unique" ON "post_snapshots" USING btree ("activity_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "post_snapshots_date_idx" ON "post_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "posts_posted_at_idx" ON "posts" USING btree ("posted_at");