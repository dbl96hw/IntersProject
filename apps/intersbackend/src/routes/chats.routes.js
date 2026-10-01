import { Router } from 'express';
import { z } from 'zod';
import { API_PATHS, HTTP_STATUS, MAX_CHAT_TITLE_LENGTH } from '../constants/index.js';
import { validationError } from '../errors.js';
import { asyncHandler, requireUuid } from './helpers.js';

const createChatSchema = z.object({
  title: z.string({ error: 'title must be a string' }).trim().max(MAX_CHAT_TITLE_LENGTH).optional(),
});

const messageSchema = z.object({
  text: z.string({ error: 'text must be a string' }).trim().optional(),
});

export function createChatsRouter({ chatsService, upload }) {
  const router = Router();

  router.post(API_PATHS.CHATS, asyncHandler(async (req, res) => {
    const input = createChatSchema.parse(req.body ?? {});
    res.status(HTTP_STATUS.CREATED).json({ chat: await chatsService.createChat(input) });
  }));

  router.get(API_PATHS.CHATS, asyncHandler(async (req, res) => {
    res.json({ chats: await chatsService.listChats() });
  }));

  router.get(API_PATHS.CHAT, asyncHandler(async (req, res) => {
    const chatId = requireUuid(req.params.id, 'Chat');
    res.json(await chatsService.getChatWithMessages(chatId));
  }));

  router.post(
    API_PATHS.CHAT_MESSAGES,
    // Checked before the upload so a malformed id never buffers files.
    asyncHandler(async (req, res, next) => {
      requireUuid(req.params.id, 'Chat');
      next();
    }),
    upload,
    asyncHandler(async (req, res) => {
      const { text } = messageSchema.parse(req.body ?? {});
      const uploads = req.files ?? [];
      if (!text && uploads.length === 0) throw validationError('Send text or at least one file', 'text');
      const result = await chatsService.postMessage(req.params.id, { text: text || null, uploads });
      res.status(HTTP_STATUS.CREATED).json(result);
    }),
  );

  router.post(API_PATHS.MESSAGE_RETRY, asyncHandler(async (req, res) => {
    const chatId = requireUuid(req.params.id, 'Chat');
    const messageId = requireUuid(req.params.messageId, 'Message');
    res.status(HTTP_STATUS.CREATED).json(await chatsService.retryMessage(chatId, messageId));
  }));

  return router;
}
