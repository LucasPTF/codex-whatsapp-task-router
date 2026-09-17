import type { Store } from "../database/store.ts";

export type WhatsAppTeamIdentity = {
  employeeId: string;
  displayName: string;
};

type SeedIdentity = WhatsAppTeamIdentity & {
  kind: "phone" | "name";
  value: string;
};

function normalizePhone(value: string) {
  return value.replace(/\D/gu, "");
}

function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/^~/u, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR");
}

function phoneFromSenderId(senderId: string) {
  const localPart = senderId.split("@", 1)[0]?.split(":", 1)[0] ?? "";
  const digits = normalizePhone(localPart);
  return digits.length >= 10 ? digits : "";
}

function normalizedValue(kind: "phone" | "name", value: string) {
  return kind === "phone" ? normalizePhone(value) : normalizeName(value);
}

const TEAM_IDENTITIES: SeedIdentity[] = [
  {
    kind: "phone",
    value: "+1 202-555-0100",
    employeeId: "gestor",
    displayName: "Alex · Gestão",
  },
  {
    kind: "name",
    value: "Alex Demo",
    employeeId: "gestor",
    displayName: "Alex · Gestão",
  },
  {
    kind: "phone",
    value: "+1 202-555-0101",
    employeeId: "magda",
    displayName: "Ana · Conteúdo",
  },
  {
    kind: "name",
    value: "Ana Demo",
    employeeId: "magda",
    displayName: "Ana · Conteúdo",
  },
  {
    kind: "phone",
    value: "+1 202-555-0102",
    employeeId: "sabrina",
    displayName: "Bia · Revisão",
  },
  {
    kind: "name",
    value: "Bia Demo",
    employeeId: "sabrina",
    displayName: "Bia · Revisão",
  },
  {
    kind: "phone",
    value: "+1 202-555-0103",
    employeeId: "lucas",
    displayName: "Caio · Web",
  },
  {
    kind: "name",
    value: "Caio Demo",
    employeeId: "lucas",
    displayName: "Caio · Web",
  },
  {
    kind: "phone",
    value: "+1 202-555-0104",
    employeeId: "thay",
    displayName: "Dani · Mídia",
  },
  {
    kind: "name",
    value: "Dani Demo",
    employeeId: "thay",
    displayName: "Dani · Mídia",
  },
  {
    kind: "phone",
    value: "+1 202-555-0105",
    employeeId: "magda",
    displayName: "Estúdio Exemplo · Conteúdo",
  },
  {
    kind: "name",
    value: "Estúdio Exemplo",
    employeeId: "magda",
    displayName: "Estúdio Exemplo · Conteúdo",
  },
];

export function resolveWhatsAppTeamIdentity(
  store: Store,
  accountId: string,
  senderId: string,
  senderName?: string | null,
): WhatsAppTeamIdentity | null {
  const phone = phoneFromSenderId(senderId);
  const name = senderName ? normalizeName(senderName) : "";
  const row = phone
    ? store.db
        .prepare(
          "SELECT employee_id,display_name FROM whatsapp_team_identities WHERE account_id=? AND match_kind='phone' AND match_value=?",
        )
        .get(accountId, phone)
    : null;
  const match =
    row ??
    (name
      ? store.db
          .prepare(
            "SELECT employee_id,display_name FROM whatsapp_team_identities WHERE account_id=? AND match_kind='name' AND match_value=?",
          )
          .get(accountId, name)
      : null);
  return match
    ? {
        employeeId: String(match.employee_id),
        displayName: String(match.display_name),
      }
    : null;
}

export function availableTeamDisplayName(
  store: Store,
  projectId: string,
  requestedName: string,
  senderId: string,
) {
  const occupied = store.db
    .prepare(
      "SELECT external_sender_id FROM participants WHERE project_id=? AND display_name=?",
    )
    .get(projectId, requestedName);
  if (!occupied || occupied.external_sender_id === senderId)
    return requestedName;
  const digits = phoneFromSenderId(senderId);
  const suffix = digits.slice(-4) || senderId.slice(0, 8);
  let candidate = `${requestedName} · ${suffix}`;
  let index = 2;
  while (
    store.db
      .prepare(
        "SELECT 1 FROM participants WHERE project_id=? AND display_name=?",
      )
      .get(projectId, candidate)
  ) {
    candidate = `${requestedName} · ${suffix}-${index}`;
    index += 1;
  }
  return candidate;
}

export function seedDemoWhatsAppTeamDirectory(
  store: Store,
  accountId = "primary",
  now = new Date().toISOString(),
) {
  const insert = store.db.prepare(
    "INSERT INTO whatsapp_team_identities(account_id,match_kind,match_value,employee_id,display_name,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,match_kind,match_value) DO UPDATE SET employee_id=excluded.employee_id,display_name=excluded.display_name",
  );
  for (const identity of TEAM_IDENTITIES)
    insert.run(
      accountId,
      identity.kind,
      normalizedValue(identity.kind, identity.value),
      identity.employeeId,
      identity.displayName,
      now,
    );
  return reconcileWhatsAppTeamParticipants(store);
}

export function reconcileWhatsAppTeamParticipants(store: Store) {
  const participants = store.db
    .prepare(
      "SELECT p.id,p.project_id,p.external_sender_id,c.account_id,(SELECT m.sender_name FROM whatsapp_raw_messages m WHERE m.account_id=c.account_id AND m.conversation_id=c.conversation_id AND m.sender_id=p.external_sender_id AND m.sender_name IS NOT NULL ORDER BY m.sent_at DESC,m.id DESC LIMIT 1) sender_name FROM participants p JOIN whatsapp_raw_chats c ON c.project_id=p.project_id WHERE p.external_sender_id IS NOT NULL",
    )
    .all();
  let updated = 0;
  for (const participant of participants) {
    const identity = resolveWhatsAppTeamIdentity(
      store,
      String(participant.account_id),
      String(participant.external_sender_id),
      participant.sender_name ? String(participant.sender_name) : null,
    );
    if (!identity) continue;
    const displayName = availableTeamDisplayName(
      store,
      String(participant.project_id),
      identity.displayName,
      String(participant.external_sender_id),
    );
    updated += Number(
      store.db
        .prepare(
          "UPDATE participants SET display_name=?,role='team' WHERE id=? AND (display_name<>? OR role<>'team')",
        )
        .run(displayName, participant.id, displayName).changes,
    );
  }
  return updated;
}
