CREATE TABLE "post_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"skill_hash" text NOT NULL,
	"what_worked" text NOT NULL,
	"what_could_improve" text NOT NULL,
	"rewrite_suggestions" text NOT NULL,
	"lesson_to_remember" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"thinking_tokens" integer
);
--> statement-breakpoint
ALTER TABLE "post_analyses" ADD CONSTRAINT "post_analyses_activity_id_posts_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."posts"("activity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_analyses_activity_idx" ON "post_analyses" USING btree ("activity_id");