CREATE TYPE "public"."card_type" AS ENUM('recognition', 'production', 'cloze');--> statement-breakpoint
CREATE TYPE "public"."jlpt" AS ENUM('N5', 'N4', 'N3', 'N2', 'N1');--> statement-breakpoint
CREATE TYPE "public"."pos" AS ENUM('Noun', 'Verb 1', 'Verb 2', 'Verb 3', 'I-adjective', 'Na-adjective', 'Adverb', 'Particle', 'Conjunction', 'Counter', 'Expression');--> statement-breakpoint
CREATE TYPE "public"."sentence_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transitivity" AS ENUM('transitive', 'intransitive');--> statement-breakpoint
CREATE TABLE "card_states" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" real,
	"difficulty" real,
	"state" integer NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word_id" uuid NOT NULL,
	"card_type" "card_type" NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dict_cache" (
	"headword" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanji" (
	"char" text PRIMARY KEY NOT NULL,
	"han_viet" text[] DEFAULT '{}' NOT NULL,
	"meaning_vi" text,
	"jlpt" "jlpt"
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"state" integer NOT NULL,
	"elapsed_days" real NOT NULL,
	"scheduled_days" real NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word_id" uuid NOT NULL,
	"jp" text NOT NULL,
	"jp_ruby" text NOT NULL,
	"vi" text NOT NULL,
	"source" "sentence_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"new_per_day" integer DEFAULT 12 NOT NULL,
	"reviews_per_day" integer DEFAULT 100 NOT NULL,
	"request_retention" real DEFAULT 0.9 NOT NULL,
	"theme" text DEFAULT 'light' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_kanji" (
	"word_id" uuid NOT NULL,
	"kanji_char" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "word_kanji_word_id_kanji_char_position_pk" PRIMARY KEY("word_id","kanji_char","position")
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"headword" text NOT NULL,
	"reading" text NOT NULL,
	"meaning" text NOT NULL,
	"pos" "pos" NOT NULL,
	"transitivity" "transitivity",
	"jlpt" "jlpt",
	"note" text,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_states" ADD CONSTRAINT "card_states_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_kanji" ADD CONSTRAINT "word_kanji_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_kanji" ADD CONSTRAINT "word_kanji_kanji_char_kanji_char_fk" FOREIGN KEY ("kanji_char") REFERENCES "public"."kanji"("char") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_states_due_idx" ON "card_states" USING btree ("due");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_word_type_idx" ON "cards" USING btree ("word_id","card_type");--> statement-breakpoint
CREATE INDEX "review_logs_card_reviewed_idx" ON "review_logs" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "sentences_word_idx" ON "sentences" USING btree ("word_id");--> statement-breakpoint
CREATE INDEX "word_kanji_char_idx" ON "word_kanji" USING btree ("kanji_char");--> statement-breakpoint
CREATE UNIQUE INDEX "words_headword_reading_idx" ON "words" USING btree ("headword","reading");