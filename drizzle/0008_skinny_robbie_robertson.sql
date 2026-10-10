CREATE TYPE "public"."card_kind" AS ENUM('word', 'grammar');--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "kind" "card_kind" DEFAULT 'word' NOT NULL;