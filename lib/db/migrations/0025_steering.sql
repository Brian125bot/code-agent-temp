CREATE TABLE "steering_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"seq" integer NOT NULL,
	"body" text NOT NULL,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "steering_messages" ADD CONSTRAINT "steering_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "steering_task_idx" ON "steering_messages" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "steering_task_seq_idx" ON "steering_messages" USING btree ("task_id","seq");
