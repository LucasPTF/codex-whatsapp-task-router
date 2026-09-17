export type ConnectorCapabilities = {
  existingGroups: boolean;
  history: "none" | "partial" | "import";
  outgoingHumanMessages: boolean;
  edits: boolean;
  deletions: boolean;
};
export type Coverage = {
  conversationId: string;
  capturedFrom: string | null;
  syncedThrough: string | null;
  gaps: { from: string; to: string | null; reason: string }[];
};
export type HistoricalMessageQuery = {
  from: string;
  through: string;
};
export type WhatsAppConnectorMessage = {
  accountId: string;
  externalId: string;
  conversationId: string;
  conversationTitle: string;
  isGroup: boolean;
  senderId: string;
  senderName?: string | null;
  direction: "incoming" | "outgoing";
  text: string;
  sentAt: string;
  messageType: string;
  hasMedia: boolean;
};
export type WhatsAppConnectorStatus = {
  state:
    | "disabled"
    | "initializing"
    | "qr_required"
    | "connected"
    | "syncing"
    | "disconnected"
    | "error";
  lastError: string | null;
};
export type WhatsAppPairingStatus = {
  state: WhatsAppConnectorStatus["state"];
  qrDataUrl: string | null;
};
const nonConversationMessageTypes = new Set([
  "albumMessage",
  "associatedChildMessage",
  "messageContextInfo",
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "unknown",
  "secretEncryptedMessage",
]);

export function isWhatsAppConversationContent(messageType: string) {
  return !nonConversationMessageTypes.has(messageType);
}

export interface ReadOnlyWhatsAppConnector {
  capabilities: ConnectorCapabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(
    handler: (event: WhatsAppConnectorMessage) => Promise<void>,
  ): () => void;
  fetchMessages(
    query: HistoricalMessageQuery,
  ): AsyncIterable<WhatsAppConnectorMessage>;
  status(): WhatsAppConnectorStatus;
  pairing(): WhatsAppPairingStatus;
  getCoverage(): Promise<Coverage[]>;
  downloadAttachment(id: string): Promise<{ bytes: Uint8Array; mime: string }>;
}
// Sem implementação real nesta base. Não há métodos de envio, reação ou exclusão.
