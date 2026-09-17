-- Preserve uncertainty consistently in UI, SLA and model input.
UPDATE projects SET revision=revision+1 WHERE id IN (
  SELECT project_id FROM participants
  WHERE external_sender_id LIKE 'unknown-group-participant:%' AND role='client'
);
UPDATE participants SET role='unknown'
WHERE external_sender_id LIKE 'unknown-group-participant:%' AND role='client';

UPDATE whatsapp_analysis_batches SET status='succeeded'
WHERE status='needs_review' AND NOT EXISTS (
  SELECT 1 FROM analysis_proposals a
  WHERE a.analysis_run_id=whatsapp_analysis_batches.analysis_run_id AND a.status='pending'
);

ALTER TABLE whatsapp_analysis_batches ADD COLUMN available_at TEXT;
ALTER TABLE analysis_runs ADD COLUMN error_detail TEXT;
ALTER TABLE analysis_proposals ADD COLUMN operation TEXT NOT NULL DEFAULT 'upsert' CHECK(operation IN ('upsert','complete','cancel'));
ALTER TABLE analysis_proposals ADD COLUMN expected_task_version INTEGER;

CREATE TABLE analysis_message_decisions(
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('demand','resolved','no_action','context','review')),
  request_keys TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY(analysis_run_id,message_id)
);
