import { createHash } from "node:crypto";

export type ParsedWhatsAppMessage = {
  line: number;
  sentAt: string;
  sender: string;
  text: string;
};

export type WhatsAppImportPreview = {
  format: "whatsapp-text-pt-br";
  contentHash: string;
  messageCount: number;
  skippedLines: number;
  participants: { name: string; messageCount: number }[];
  capturedFrom: string | null;
  capturedThrough: string | null;
  messages: ParsedWhatsAppMessage[];
};

const bracketed =
  /^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*([^:]+):\s?(.*)$/;
const plain =
  /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–]\s*([^:]+):\s?(.*)$/;
const timestampedSystemLine =
  /^\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}/;

function normalizedIso(parts: RegExpMatchArray, utcOffset: string) {
  const year =
    Number(parts[3]) < 100 ? 2000 + Number(parts[3]) : Number(parts[3]);
  const month = Number(parts[2]);
  const day = Number(parts[1]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6] ?? "0");
  const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maximumDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new Error("INVALID_EXPORT_DATE");
  const value = `${String(year).padStart(4, "0")}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}T${parts[4].padStart(2, "0")}:${parts[5]}:${(parts[6] ?? "00").padStart(2, "0")}${utcOffset}`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_EXPORT_DATE");
  return date.toISOString();
}

export function parseWhatsAppExport(
  input: string,
  utcOffset = "-03:00",
): WhatsAppImportPreview {
  if (!/^(?:[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(utcOffset))
    throw new Error("INVALID_UTC_OFFSET");
  if (!input.trim()) throw new Error("EMPTY_WHATSAPP_EXPORT");
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\r\n?/g, "\n");
  const lines = normalized.split(/\r?\n/);
  const messages: ParsedWhatsAppMessage[] = [];
  let skippedLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(bracketed) ?? line.match(plain);
    if (match) {
      messages.push({
        line: index + 1,
        sentAt: normalizedIso(match, utcOffset),
        sender: match[7].trim(),
        text: match[8].trim(),
      });
    } else if (timestampedSystemLine.test(line)) {
      skippedLines += 1;
    } else if (messages.length > 0 && line.trim()) {
      messages[messages.length - 1].text += "\n" + line.trim();
    } else if (line.trim()) skippedLines += 1;
  }
  if (messages.length === 0) throw new Error("WHATSAPP_FORMAT_NOT_RECOGNIZED");
  const participantCounts = new Map<string, number>();
  for (const message of messages)
    participantCounts.set(
      message.sender,
      (participantCounts.get(message.sender) ?? 0) + 1,
    );
  return {
    format: "whatsapp-text-pt-br",
    contentHash: createHash("sha256").update(normalized).digest("hex"),
    messageCount: messages.length,
    skippedLines,
    participants: [...participantCounts]
      .map(([name, messageCount]) => ({ name, messageCount }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    capturedFrom: messages[0]?.sentAt ?? null,
    capturedThrough: messages.at(-1)?.sentAt ?? null,
    messages,
  };
}
