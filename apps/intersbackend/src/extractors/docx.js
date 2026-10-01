import mammoth from 'mammoth';

// Plain text only: Claude reads it to extract records; formatting carries no data.
export async function extractDocxText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}
