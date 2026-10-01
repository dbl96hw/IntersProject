import {
  DEFAULT_CHAT_TITLE,
  MAX_CHAT_TITLE_LENGTH,
  MESSAGE_KINDS,
  MESSAGE_STATUS,
  ROLES,
} from '../constants/index.js';
import { notFoundError, validationError } from '../errors.js';
import { toStoragePath } from './fileStorage.js';
import { toChatResponse, toMessageResponse } from './responses.js';

function titleFromFiles(files) {
  return files.map((file) => file.name).join(', ').slice(0, MAX_CHAT_TITLE_LENGTH);
}

function groupBy(rows, key) {
  const groups = new Map();
  rows.forEach((row) => groups.set(row[key], [...(groups.get(row[key]) ?? []), row]));
  return groups;
}

export function createChatsService({ db, fileStorage, analysisService }) {
  async function requireChat(id) {
    const chat = await db.chats.getChat(id);
    if (!chat) throw notFoundError('Chat');
    return chat;
  }

  async function storeFiles(chatId, messageId, uploads) {
    const inputs = await Promise.all(uploads.map(async (upload, index) => {
      const storagePath = toStoragePath(chatId, messageId, index, upload.originalname);
      await fileStorage.save(storagePath, upload.buffer, upload.mimetype);
      return {
        chat_id: chatId,
        message_id: messageId,
        name: upload.originalname,
        mime_type: upload.mimetype,
        size_bytes: upload.size,
        storage_path: storagePath,
      };
    }));
    return db.files.saveFiles(inputs);
  }

  async function loadFileBuffers(fileRows) {
    return Promise.all(fileRows.map(async (row) => ({
      name: row.name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      buffer: await fileStorage.read(row.storage_path),
    })));
  }

  async function runAnalysis(chatId, { text, files }) {
    const result = await analysisService.handleMessage({ text, files });
    const assistant = await db.messages.saveMessage({ ...result.message, chat_id: chatId, role: ROLES.ASSISTANT });
    const candidates = await db.candidates.saveCandidates(
      result.candidates.map((candidate) => ({ ...candidate, chat_id: chatId, message_id: assistant.id })),
    );
    return toMessageResponse(assistant, { candidates });
  }

  return {
    async createChat(input) {
      return toChatResponse(await db.chats.createChat(input));
    },

    async listChats() {
      return (await db.chats.listChats()).map(toChatResponse);
    },

    async getChatWithMessages(id) {
      const chat = await requireChat(id);
      const [messages, files, candidates] = await Promise.all([
        db.messages.listMessages(id),
        db.files.listFilesByChat(id),
        db.candidates.listCandidatesByChat(id),
      ]);
      const filesByMessage = groupBy(files, 'message_id');
      const candidatesByMessage = groupBy(candidates, 'message_id');
      return {
        chat: toChatResponse(chat),
        messages: messages.map((message) => toMessageResponse(message, {
          files: filesByMessage.get(message.id),
          candidates: candidatesByMessage.get(message.id),
        })),
      };
    },

    // uploads: multer files (originalname, mimetype, size, buffer)
    async postMessage(chatId, { text, uploads }) {
      const chat = await requireChat(chatId);
      const userMessage = await db.messages.saveMessage({ chat_id: chatId, role: ROLES.USER, kind: MESSAGE_KINDS.TEXT, text });
      const fileRows = await storeFiles(chatId, userMessage.id, uploads);
      const files = uploads.map((upload) => ({
        name: upload.originalname,
        mime_type: upload.mimetype,
        size_bytes: upload.size,
        buffer: upload.buffer,
      }));

      const assistantMessage = await runAnalysis(chatId, { text, files });
      if (chat.title === DEFAULT_CHAT_TITLE && files.length > 0) {
        await db.chats.updateChatTitle(chatId, titleFromFiles(files));
      }

      return {
        user_message: toMessageResponse(userMessage, { files: fileRows }),
        assistant_message: assistantMessage,
      };
    },

    async retryMessage(chatId, messageId) {
      await requireChat(chatId);
      const failed = await db.messages.getMessage(messageId);
      if (!failed || failed.chat_id !== chatId) throw notFoundError('Message');
      if (failed.role !== ROLES.ASSISTANT || failed.status !== MESSAGE_STATUS.ERROR) {
        throw validationError('Only an assistant message with status "error" can be retried', 'messageId');
      }

      const messages = await db.messages.listMessages(chatId);
      const userMessage = messages
        .filter((message) => message.role === ROLES.USER && message.created_at < failed.created_at)
        .at(-1);
      if (!userMessage) throw validationError('No user message found before this message', 'messageId');

      const files = await loadFileBuffers(await db.files.listFilesByMessage(userMessage.id));
      return { assistant_message: await runAnalysis(chatId, { text: userMessage.text, files }) };
    },
  };
}
