CREATE TABLE "pr_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"check_run_id" text NOT NULL,
	"conclusion" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pr_checks_check_run_id_unique" UNIQUE("check_run_id")
);
--> statement-breakpoint
ALTER TABLE "pr_checks" ADD CONSTRAINT "pr_checks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_checks_task_idx" ON "pr_checks" USING btree ("task_id");
