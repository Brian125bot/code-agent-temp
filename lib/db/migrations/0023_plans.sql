CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"authored_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_task_id_idx" ON "plans" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_task_version_idx" ON "plans" USING btree ("task_id","version");
