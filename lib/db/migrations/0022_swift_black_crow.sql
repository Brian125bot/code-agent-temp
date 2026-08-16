CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"task_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "max_duration" SET DEFAULT 60;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "gateway_model" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "enable_browser" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "webhook_source" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ingest_cursor" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;