import { join } from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  isJidGroup,
  normalizeMessageContent,
  useMultiFileAuthState,
  type Chat,
  type Contact,
  type WASocket,
  type WAMessage,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import type {
  Coverage,
  HistoricalMessageQuery,
  ReadOnlyWhatsAppConnector,
  WhatsAppConnectorMessage,
  WhatsAppConnectorStatus,
  WhatsAppPairingStatus,
} from "./connector.ts";
import {
  connectedAccountFallbackId,
  unknownGroupParticipantId,
} from "./participants.ts";

const HISTORY_QUIET_MS = 15_000;

export type BaileysConnectorOptions = {
  accountId: string;
  authPath: string;
};

type DisconnectError = Error & {
  output?: { statusCode?: number };
};

function timestamp(message: WAMessage) {
  const value = Number(message.messageTimestamp ?? 0);
  return Number.isFinite(value) && value > 0 ? value * 1000 : 0;
}

function mediaType(type: string | undefined) {
  return [
    "audioMessage",
    "documentMessage",
    "imageMessage",
    "stickerMessage",
    "videoMessage",
  ].includes(type ?? "");
}

function messageText(message: WAMessage) {
  const content = normalizeMessageContent(message.message);
  const type = getContentType(content);
  if (!content || !type) return "";
  if (type === "conversation") return content.conversation ?? "";
  if (type === "extendedTextMessage")
    return content.extendedTextMessage?.text ?? "";
  if (type === "imageMessage")
    return content.imageMessage?.caption ?? "[imagem]";
  if (type === "videoMessage")
    return content.videoMessage?.caption ?? "[vídeo]";
  if (type === "audioMessage") return "[áudio]";
  if (type === "stickerMessage") return "[figurinha]";
  if (type === "documentMessage")
    return (
      content.documentMessage?.caption ??
      content.documentMessage?.fileName ??
      "[documento]"
    );
  if (type === "buttonsResponseMessage")
    return content.buttonsResponseMessage?.selectedDisplayText ?? "";
  if (type === "listResponseMessage")
    return content.listResponseMessage?.title ?? "";
  if (type === "pollCreationMessage")
    return content.pollCreationMessage?.name ?? "[enquete]";
  if (type === "contactMessage") return "[contato]";
  if (type === "lottieStickerMessage") return "[figurinha]";
  if (type === "ptvMessage") return "[vídeo]";
  return `[${type}]`;
}

export class BaileysReadOnlyConnector implements ReadOnlyWhatsAppConnector {
  readonly capabilities = {
    existingGroups: true,
    history: "partial" as const,
    outgoingHumanMessages: true,
    edits: false,
    deletions: false,
  };
  private readonly options: BaileysConnectorOptions;
  private readonly logger = pino({ level: "silent" });
  private socket: WASocket | null = null;
  private stopped = false;
  private connected = false;
  private currentStatus: WhatsAppConnectorStatus = {
    state: "disabled",
    lastError: null,
  };
  private qrDataUrl: string | null = null;
  private readonly messages = new Map<string, WAMessage>();
  private readonly messagesById = new Map<string, WAMessage>();
  private readonly titles = new Map<string, string>();
  private readonly subscribers = new Set<
    (event: WhatsAppConnectorMessage) => Promise<void>
  >();

  constructor(options: BaileysConnectorOptions) {
    this.options = options;
  }

  status() {
    return { ...this.currentStatus };
  }

  pairing(): WhatsAppPairingStatus {
    return { state: this.currentStatus.state, qrDataUrl: this.qrDataUrl };
  }

  setSyncing(syncing: boolean) {
    if (syncing && this.connected)
      this.currentStatus = { state: "syncing", lastError: null };
    else if (!syncing && this.connected)
      this.currentStatus = { state: "connected", lastError: null };
  }

  private rememberChat(chat: Chat) {
    if (chat.id && chat.name) this.titles.set(chat.id, chat.name);
  }

  private rememberContact(contact: Contact) {
    const title = contact.name ?? contact.verifiedName ?? contact.notify;
    if (contact.id && title) this.titles.set(contact.id, title);
    if (contact.lid && title) this.titles.set(contact.lid, title);
  }

  private rememberMessage(message: WAMessage) {
    const remote = message.key.remoteJid;
    const id = message.key.id;
    if (!remote || !id || remote === "status@broadcast" || !timestamp(message))
      return;
    this.messages.set(`${remote}:${id}`, message);
    this.messagesById.set(id, message);
  }

  private toEvent(message: WAMessage): WhatsAppConnectorMessage | null {
    const remote = message.key.remoteJid;
    const id = message.key.id;
    const sentAt = timestamp(message);
    if (!remote || !id || remote === "status@broadcast" || !sentAt) return null;
    const content = normalizeMessageContent(message.message);
    const type = getContentType(content);
    const isGroup = Boolean(isJidGroup(remote));
    return {
      accountId: this.options.accountId,
      externalId: id,
      conversationId: remote,
      conversationTitle: this.titles.get(remote) ?? remote,
      isGroup,
      senderId:
        message.key.participantAlt ??
        message.key.participant ??
        message.participant ??
        (message.key.fromMe
          ? (this.socket?.user?.id ?? connectedAccountFallbackId())
          : isGroup
            ? unknownGroupParticipantId(remote)
            : remote),
      senderName: message.pushName ?? this.titles.get(message.key.participant ?? message.participant ?? "") ?? null,
      direction: message.key.fromMe ? "outgoing" : "incoming",
      text: messageText(message),
      sentAt: new Date(sentAt).toISOString(),
      messageType: type ?? "unknown",
      hasMedia: mediaType(type),
    };
  }

  async connect() {
    if (this.socket || this.currentStatus.state === "initializing") return;
    this.stopped = false;
    this.currentStatus = { state: "initializing", lastError: null };
    const { state, saveCreds } = await useMultiFileAuthState(
      join(this.options.authPath, "baileys-leitor-whatsapp"),
    );

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let opened = false;
      let historyTimer: NodeJS.Timeout | null = null;
      const finish = () => {
        if (settled || !opened) return;
        settled = true;
        if (historyTimer) clearTimeout(historyTimer);
        this.currentStatus = { state: "connected", lastError: null };
        resolve();
      };
      const waitForHistory = () => {
        if (!opened) return;
        if (historyTimer) clearTimeout(historyTimer);
        historyTimer = setTimeout(() => {
          if (settled && this.connected)
            this.currentStatus = { state: "connected", lastError: null };
          else finish();
        }, HISTORY_QUIET_MS);
      };
      let reconnectAttempts = 0;
      const startSocket = () => {
        if (this.stopped) return;
        const socket = makeWASocket({
          auth: state,
          browser: Browsers.ubuntu("Chrome"),
          syncFullHistory: true,
          markOnlineOnConnect: false,
          emitOwnEvents: false,
          logger: this.logger,
        });
        this.socket = socket;
        socket.ev.on("creds.update", saveCreds);
        socket.ev.on("chats.upsert", (chats) => {
          for (const chat of chats) this.rememberChat(chat);
        });
        socket.ev.on("contacts.upsert", (contacts) => {
          for (const contact of contacts) this.rememberContact(contact);
        });
        socket.ev.on(
          "messaging-history.set",
          ({ chats, contacts, messages, isLatest, progress }) => {
            this.currentStatus = { state: "syncing", lastError: null };
            for (const chat of chats) this.rememberChat(chat);
            for (const contact of contacts) this.rememberContact(contact);
            for (const message of messages) {
              this.rememberMessage(message);
              const event = this.toEvent(message);
              if (event) for (const subscriber of this.subscribers)
                void subscriber(event).catch(() => {
                  this.currentStatus = { state: "error", lastError: "WHATSAPP_EVENT_FAILED" };
                });
            }
            waitForHistory();
          },
        );
        socket.ev.on("messages.upsert", ({ messages }) => {
          for (const message of messages) {
            this.rememberMessage(message);
            const event = this.toEvent(message);
            if (!event) continue;
            for (const subscriber of this.subscribers)
              void subscriber(event).catch(() => {
                this.currentStatus = {
                  state: "error",
                  lastError: "WHATSAPP_EVENT_FAILED",
                };
              });
          }
        });
        socket.ev.on("connection.update", (update) => {
          if (this.socket !== socket) return;
          if (update.qr) {
            this.currentStatus = { state: "qr_required", lastError: null };
            void QRCode.toDataURL(update.qr, {
              errorCorrectionLevel: "M",
              margin: 2,
              width: 340,
            }).then((value) => {
              if (this.socket === socket) this.qrDataUrl = value;
            });
          }
          if (update.connection === "open") {
            reconnectAttempts = 0;
            opened = true;
            this.connected = true;
            this.qrDataUrl = null;
            this.currentStatus = { state: "syncing", lastError: null };
            waitForHistory();
          }
          if (update.connection !== "close") return;
          opened = false;
          this.connected = false;
          if (historyTimer) clearTimeout(historyTimer);
          const error = update.lastDisconnect?.error as
            | DisconnectError
            | undefined;
          const disconnectCode = error?.output?.statusCode;
          const loggedOut = disconnectCode === DisconnectReason.loggedOut;
          console.error(
            "whatsapp_connection_closed",
            disconnectCode ?? "unknown",
            error?.message ?? "unknown",
          );
          this.socket = null;
          this.qrDataUrl = null;
          if (loggedOut) {
            this.currentStatus = {
              state: "error",
              lastError: "WHATSAPP_LOGGED_OUT",
            };
            if (!settled) {
              settled = true;
              reject(new Error("WHATSAPP_LOGGED_OUT"));
            }
          } else if (!this.stopped) {
            this.currentStatus = {
              state: "disconnected",
              lastError: "WHATSAPP_RECONNECTING",
            };
            reconnectAttempts += 1;
            const retryIn = Math.min(
              5_000 * 2 ** Math.min(reconnectAttempts - 1, 3),
              60_000,
            );
            setTimeout(startSocket, retryIn);
          }
        });
      };
      startSocket();
    });
  }

  async disconnect() {
    this.stopped = true;
    this.connected = false;
    this.qrDataUrl = null;
    const socket = this.socket;
    this.socket = null;
    socket?.end(undefined);
    this.currentStatus = { state: "disconnected", lastError: null };
  }

  subscribe(handler: (event: WhatsAppConnectorMessage) => Promise<void>) {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  async *fetchMessages(query: HistoricalMessageQuery) {
    const from = Date.parse(query.from);
    const through = Date.parse(query.through);
    if (!Number.isFinite(from) || !Number.isFinite(through) || from > through)
      throw new Error("INVALID_HISTORY_QUERY");
    if (!this.connected) throw new Error("WHATSAPP_NOT_CONNECTED");
    const ordered = [...this.messages.values()].sort(
      (left, right) => timestamp(left) - timestamp(right),
    );
    for (const message of ordered) {
      const sentAt = timestamp(message);
      if (sentAt < from || sentAt > through) continue;
      const event = this.toEvent(message);
      if (event) yield event;
    }
  }

  async getCoverage(): Promise<Coverage[]> {
    const coverage = new Map<string, { from: number; through: number }>();
    for (const message of this.messages.values()) {
      const conversationId = message.key.remoteJid;
      const sentAt = timestamp(message);
      if (!conversationId || !sentAt) continue;
      const current = coverage.get(conversationId);
      coverage.set(conversationId, {
        from: Math.min(current?.from ?? sentAt, sentAt),
        through: Math.max(current?.through ?? sentAt, sentAt),
      });
    }
    return [...coverage.entries()].map(([conversationId, value]) => ({
      conversationId,
      capturedFrom: new Date(value.from).toISOString(),
      syncedThrough: new Date(value.through).toISOString(),
      gaps: [],
    }));
  }

  async downloadAttachment(id: string) {
    const message = this.messagesById.get(id);
    const socket = this.socket;
    if (!message || !socket) throw new Error("ATTACHMENT_NOT_AVAILABLE");
    const content = normalizeMessageContent(message.message);
    const type = getContentType(content);
    if (!mediaType(type)) throw new Error("ATTACHMENT_NOT_AVAILABLE");
    const bytes = await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger: this.logger,
        reuploadRequest: socket.updateMediaMessage,
      },
    );
    const mime =
      content?.imageMessage?.mimetype ??
      content?.videoMessage?.mimetype ??
      content?.audioMessage?.mimetype ??
      content?.documentMessage?.mimetype ??
      content?.stickerMessage?.mimetype ??
      "application/octet-stream";
    return { bytes: Uint8Array.from(bytes), mime };
  }
}
