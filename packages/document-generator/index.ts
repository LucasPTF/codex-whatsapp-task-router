import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import type { Task } from "../core/model.ts";
export async function taskDocument(
  task: Task,
  evidence: { text: string; sent_at: string }[],
): Promise<Buffer> {
  const doc = new Document({
    creator: "Controle Interno",
    title: task.title,
    sections: [
      {
        children: [
          new Paragraph({ text: task.title, heading: HeadingLevel.TITLE }),
          new Paragraph({
            children: [
              new TextRun({
                text: "BRIEFING DA TAREFA — DEMONSTRAÇÃO",
                bold: true,
              }),
            ],
          }),
          new Paragraph(
            "Este arquivo organiza a demanda. Não é copy gerada por IA nem comprovação de entrega.",
          ),
          new Paragraph(
            "Projeto: " +
              task.project_id +
              " | Versão da tarefa: " +
              task.version,
          ),
          new Paragraph(
            "Responsável: " +
              (task.assignee_id ?? "Triagem") +
              " | Situação: " +
              task.status,
          ),
          new Paragraph("Prazo: " + (task.due_at ?? "A definir")),
          new Paragraph(task.description),
          new Paragraph({
            text: "Evidências",
            heading: HeadingLevel.HEADING_1,
          }),
          ...evidence.map((e) => new Paragraph(e.sent_at + " — " + e.text)),
          new Paragraph({
            text: "Resultado registrado",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph(task.result ?? "Ainda não concluído."),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
