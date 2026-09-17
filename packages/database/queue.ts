import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
export class Queue {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  claim(now: string, leaseMs = 60000) {
    return this.store.transaction(() => {
      this.store.db
        .prepare(
          "UPDATE jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'retry_wait' END,lease_token=NULL,lease_until=NULL,error_code='LEASE_EXPIRED' WHERE state='running' AND lease_until<=?",
        )
        .run(now);
      const job = this.store.db
        .prepare(
          "SELECT * FROM jobs WHERE state IN ('pending','retry_wait') AND available_at<=? AND attempts<3 ORDER BY available_at,id LIMIT 1",
        )
        .get(now);
      if (!job) return null;
      const token = randomUUID();
      this.store.db
        .prepare(
          "UPDATE jobs SET state='running',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?",
        )
        .run(token, new Date(Date.parse(now) + leaseMs).toISOString(), job.id!);
      return { ...job, id: String(job.id), lease_token: token };
    });
  }
  finish(id: string, token: string, now: string) {
    return (
      this.store.db
        .prepare(
          "UPDATE jobs SET state='succeeded',lease_token=NULL,lease_until=NULL WHERE id=? AND state='running' AND lease_token=? AND lease_until>?",
        )
        .run(id, token, now).changes === 1
    );
  }
  heartbeat(id: string, token: string, now: string, leaseMs = 60000) {
    return (
      this.store.db
        .prepare(
          "UPDATE jobs SET lease_until=? WHERE id=? AND state='running' AND lease_token=? AND lease_until>?",
        )
        .run(new Date(Date.parse(now) + leaseMs).toISOString(), id, token, now)
        .changes === 1
    );
  }
}
