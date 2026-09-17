export type Role = "admin" | "manager" | "employee";
export type TaskStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";
export type TaskKind =
  | "copy"
  | "design"
  | "page"
  | "strategy"
  | "service"
  | "traffic";
export type Actor = { id: string; role: Role };
export type MessageInput = {
  id: string;
  accountId: string;
  externalId: string;
  projectId: string;
  conversationId: string;
  senderId: string;
  direction: "incoming" | "outgoing";
  text: string;
  sentAt: string;
  source: "live" | "import";
};
export type Proposal = {
  operation?: 'upsert' | 'complete' | 'cancel';
  expectedTaskVersion?: number | null;
  requestKey: string;
  title: string;
  description: string;
  kind: TaskKind;
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  evidenceIds: string[];
  needsReview: boolean;
};
export type Analysis = {
  projectId: string;
  projectRevision: number;
  summary: string;
  proposals: Proposal[];
  messageDecisions?: {
    messageId: string;
    outcome: 'demand' | 'resolved' | 'no_action' | 'context' | 'review';
    requestKeys: string[];
    reason: string;
  }[];
};
export type Task = {
  id: string;
  project_id: string;
  request_key: string;
  title: string;
  description: string;
  kind: TaskKind;
  priority: string;
  assignee_id: string | null;
  status: TaskStatus;
  version: number;
  review_required: number;
  created_at: string;
  acknowledge_by: string;
  due_at: string | null;
  result: string | null;
  block_reason: string | null;
};
export class DomainError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function demand(
  condition: unknown,
  code: string,
  status = 409,
): asserts condition {
  if (!condition) throw new DomainError(code, status);
}
