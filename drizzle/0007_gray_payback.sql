CREATE TABLE "grammar_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"meaning" text NOT NULL,
	"formation" text,
	"note" text,
	"jlpt" "jlpt",
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"import_batch_id" uuid
);
--> statement-breakpoint
CREATE TABLE "grammar_sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grammar_id" uuid NOT NULL,
	"jp" text NOT NULL,
	"jp_ruby" text NOT NULL,
	"vi" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" "sentence_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "word_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "grammar_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "grammar_per_session" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "grammar_points" ADD CONSTRAINT "grammar_points_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grammar_sentences" ADD CONSTRAINT "grammar_sentences_grammar_id_grammar_points_id_fk" FOREIGN KEY ("grammar_id") REFERENCES "public"."grammar_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grammar_points_pattern_meaning_idx" ON "grammar_points" USING btree ("pattern","meaning");--> statement-breakpoint
CREATE INDEX "grammar_points_intro_idx" ON "grammar_points" USING btree ("created_at","sort_order");--> statement-breakpoint
CREATE INDEX "grammar_points_import_batch_idx" ON "grammar_points" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "grammar_sentences_grammar_idx" ON "grammar_sentences" USING btree ("grammar_id","sort_order");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_grammar_id_grammar_points_id_fk" FOREIGN KEY ("grammar_id") REFERENCES "public"."grammar_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_grammar_idx" ON "cards" USING btree ("grammar_id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_one_owner" CHECK (num_nonnulls("cards"."word_id", "cards"."grammar_id") = 1);