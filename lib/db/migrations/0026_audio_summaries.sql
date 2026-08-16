CREATE TABLE "audio_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"blob_url" text NOT NULL,
	"transcript" text NOT NULL,
	"duration_sec" integer,
	"model_version" text NOT NULL,
	"diff_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_summaries" ADD CONSTRAINT "audio_summaries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_task_idx" ON "audio_summaries" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_task_diff_model_idx" ON "audio_summaries" USING btree ("task_id","diff_hash","model_version");
