CREATE TABLE "user_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"commented_at" timestamp with time zone NOT NULL,
	"link" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"profile_url" text NOT NULL,
	"email" text,
	"company" text,
	"position" text,
	"connected_on_raw" text NOT NULL,
	"connected_at" date
);
--> statement-breakpoint
CREATE TABLE "user_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reacted_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"link" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_comments_date_idx" ON "user_comments" USING btree ("commented_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_comments_unique" ON "user_comments" USING btree ("commented_at","link");--> statement-breakpoint
CREATE UNIQUE INDEX "user_connections_unique" ON "user_connections" USING btree ("profile_url");--> statement-breakpoint
CREATE INDEX "user_connections_date_idx" ON "user_connections" USING btree ("connected_at");--> statement-breakpoint
CREATE INDEX "user_reactions_date_idx" ON "user_reactions" USING btree ("reacted_at");--> statement-breakpoint
CREATE INDEX "user_reactions_type_idx" ON "user_reactions" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_reactions_unique" ON "user_reactions" USING btree ("reacted_at","link","type");