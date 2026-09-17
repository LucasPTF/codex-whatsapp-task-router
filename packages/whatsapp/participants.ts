import type { WhatsAppConnectorMessage } from "./connector.ts";

const UNKNOWN_GROUP_PARTICIPANT_PREFIX = "unknown-group-participant:";
const CONNECTED_ACCOUNT_FALLBACK = "connected-whatsapp-account";

export function unknownGroupParticipantId(conversationId: string) {
  return UNKNOWN_GROUP_PARTICIPANT_PREFIX + conversationId;
}

export function connectedAccountFallbackId() {
  return CONNECTED_ACCOUNT_FALLBACK;
}

export function normalizeWhatsAppSender(
  message: Pick<
    WhatsAppConnectorMessage,
    "conversationId" | "direction" | "isGroup" | "senderId"
  >,
) {
  if (
    message.isGroup &&
    message.direction === "incoming" &&
    message.senderId === message.conversationId
  )
    return unknownGroupParticipantId(message.conversationId);
  return message.senderId;
}

export function whatsappParticipantDisplayName(
  senderId: string,
  direction: "incoming" | "outgoing",
) {
  if (direction === "outgoing") return "Equipe (WhatsApp conectado)";
  if (senderId.startsWith(UNKNOWN_GROUP_PARTICIPANT_PREFIX))
    return "Cliente não identificado";
  return senderId;
}
