import { DatabaseSync } from "node:sqlite";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("Informe o caminho do banco de dados.");

const db = new DatabaseSync(databasePath, { timeout: 5000 });
db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");

const repaired = [];
try {
  const duplicateClients = db
    .prepare(
      `SELECT client_id,name
       FROM projects
       WHERE active=1 AND client_id IS NOT NULL
       GROUP BY client_id,name COLLATE NOCASE
       HAVING COUNT(*) > 1`,
    )
    .all();

  for (const duplicate of duplicateClients) {
    const projects = db
      .prepare(
        `SELECT p.id,p.revision,
                (SELECT COUNT(*) FROM messages m WHERE m.project_id=p.id) message_count
         FROM projects p
         WHERE p.client_id=? AND p.name=? COLLATE NOCASE AND p.active=1
         ORDER BY message_count DESC,p.created_at,p.id`,
      )
      .all(duplicate.client_id, duplicate.name);
    const [target, ...sources] = projects;

    for (const source of sources) {
      const dependencies = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM tasks WHERE project_id=?) tasks,
             (SELECT COUNT(*) FROM analysis_runs WHERE project_id=?) analysis_runs,
             (SELECT COUNT(*) FROM whatsapp_analysis_batches WHERE project_id=?) batches,
             (SELECT COUNT(*) FROM import_batches WHERE project_id=?) imports`,
        )
        .get(source.id, source.id, source.id, source.id);
      if (Object.values(dependencies).some((count) => Number(count) > 0))
        throw new Error(
          `Projeto ${source.id} possui dependências e não pode ser consolidado automaticamente.`,
        );

      const sourceParticipants = db
        .prepare(
          "SELECT id,display_name,external_sender_id FROM participants WHERE project_id=?",
        )
        .all(source.id);
      for (const participant of sourceParticipants) {
        const existing = participant.external_sender_id
          ? db
              .prepare(
                "SELECT id FROM participants WHERE project_id=? AND external_sender_id=?",
              )
              .get(target.id, participant.external_sender_id)
          : null;
        if (existing) {
          db.prepare(
            "UPDATE messages SET sender_id=? WHERE project_id=? AND sender_id=?",
          ).run(existing.id, source.id, participant.id);
          db.prepare("DELETE FROM participants WHERE id=?").run(participant.id);
          continue;
        }

        let displayName = String(participant.display_name);
        let suffix = 2;
        while (
          db
            .prepare(
              "SELECT 1 FROM participants WHERE project_id=? AND display_name=?",
            )
            .get(target.id, displayName)
        ) {
          displayName = `${participant.display_name} · grupo ${suffix}`;
          suffix += 1;
        }
        db.prepare(
          "UPDATE participants SET project_id=?,display_name=? WHERE id=?",
        ).run(target.id, displayName, participant.id);
      }

      db.prepare("UPDATE messages SET project_id=? WHERE project_id=?").run(
        target.id,
        source.id,
      );
      db.prepare(
        "UPDATE conversations SET project_id=? WHERE project_id=?",
      ).run(target.id, source.id);
      db.prepare(
        "UPDATE whatsapp_raw_chats SET project_id=? WHERE project_id=?",
      ).run(target.id, source.id);
      db.prepare(
        "INSERT OR IGNORE INTO project_members(project_id,employee_id) SELECT ?,employee_id FROM project_members WHERE project_id=?",
      ).run(target.id, source.id);
      db.prepare("DELETE FROM project_members WHERE project_id=?").run(
        source.id,
      );
      db.prepare("DELETE FROM project_briefs WHERE project_id=?").run(
        source.id,
      );
      db.prepare("DELETE FROM projects WHERE id=?").run(source.id);
      db.prepare(
        "UPDATE projects SET revision=revision+?,updated_at=? WHERE id=?",
      ).run(Number(source.revision), new Date().toISOString(), target.id);
      db.prepare(
        "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES('gestor','whatsapp.duplicate_project_consolidated',?,?,?)",
      ).run(
        target.id,
        JSON.stringify({
          sourceProjectId: source.id,
          exactTitle: duplicate.name,
        }),
        new Date().toISOString(),
      );
      repaired.push({
        name: duplicate.name,
        targetProjectId: target.id,
        removedProjectId: source.id,
      });
    }
  }

  db.exec("COMMIT");
  console.log(JSON.stringify({ repaired }, null, 2));
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
