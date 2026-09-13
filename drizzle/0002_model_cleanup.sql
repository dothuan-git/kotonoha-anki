-- Data first, schema second.
--
-- `cards` becomes one row per word, so the `production` rows left behind by
-- the unlock rule that no longer exists have to go before a unique index on
-- `word_id` can exist. `card_states` follows them by cascade.
--
-- Guarded on purpose: a card that carries any review history is NOT deleted.
-- If one somehow does, it survives this statement and the CREATE UNIQUE INDEX
-- further down fails loudly. A failed migration is recoverable; a silently
-- deleted review is not.
DELETE FROM "cards"
WHERE "card_type" <> 'recognition'
  AND NOT EXISTS (
    SELECT 1 FROM "review_logs" WHERE "review_logs"."card_id" = "cards"."id"
  );--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "cards_word_type_idx";--> statement-breakpoint
DROP INDEX "sentences_word_idx";--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_word_idx" ON "cards" USING btree ("word_id");--> statement-breakpoint
CREATE INDEX "words_intro_idx" ON "words" USING btree ("created_at","sort_order");--> statement-breakpoint
CREATE INDEX "words_import_batch_idx" ON "words" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sentences_word_idx" ON "sentences" USING btree ("word_id");--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "card_type";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "active";--> statement-breakpoint
DROP TYPE "public"."card_type";