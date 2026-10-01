/**
 * Upload limits and allowed file types for POST /api/chats/:id/messages.
 */

export const UPLOAD_FIELD = 'files';
export const BYTES_PER_MB = 1024 * 1024;

export const TABLE_FILE_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
export const DOCUMENT_FILE_EXTENSIONS = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
export const ALLOWED_FILE_EXTENSIONS = [...TABLE_FILE_EXTENSIONS, ...DOCUMENT_FILE_EXTENSIONS];

export const FILE_KINDS = { TABLE: 'table', DOCUMENT: 'document' };
