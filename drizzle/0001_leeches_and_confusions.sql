CREATE TABLE "confusions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"word_id" uuid NOT NULL,
	"typed_word_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "leech_acked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confusions" ADD CONSTRAINT "confusions_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confusions" ADD CONSTRAINT "confusions_typed_word_id_words_id_fk" FOREIGN KEY ("typed_word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "confusions_word_idx" ON "confusions" USING btree ("word_id");--> statement-breakpoint
CREATE INDEX "confusions_observed_idx" ON "confusions" USING btree ("observed_at");