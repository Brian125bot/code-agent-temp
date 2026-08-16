-- Extend tasks.status to include awaiting_approval. Tasks.status is plain text with app-level validation, so no DDL is strictly required. Keep this migration as a marker for the state extension.
SELECT 1;
