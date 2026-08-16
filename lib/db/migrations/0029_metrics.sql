CREATE TABLE "metrics_daily" (
	"date" date PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"tasks_created" integer DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"tasks_failed" integer DEFAULT 0 NOT NULL,
	"total_cost_cents" integer DEFAULT 0 NOT NULL
);
