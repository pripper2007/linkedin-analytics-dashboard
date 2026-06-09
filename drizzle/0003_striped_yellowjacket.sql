CREATE TABLE "profile_demographics" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"category" text NOT NULL,
	"value" text NOT NULL,
	"pct" numeric(6, 2) NOT NULL,
	"rank" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profile_demographics_unique" ON "profile_demographics" USING btree ("snapshot_date","category","value");