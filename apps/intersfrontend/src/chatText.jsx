// Renders the assistant's answer text safely. The model sometimes writes **bold** or *bold*; those
// marks become <strong> elements. Nothing else is interpreted: lists ("- "), line breaks and any HTML
// stay plain text, because React escapes every string child. No innerHTML, no markdown library.

// **x** or *x* with no space just inside the marks, so "2 * 3 * 4" is left alone.
const EMPHASIS_PATTERN = /\*\*(\S(?:[^\n]*?\S)?)\*\*|\*(\S(?:[^*\n]*?\S)?)\*/g;

export function renderChatText(text) {
  const source = String(text ?? '');
  const nodes = [];
  let last = 0;
  for (const match of source.matchAll(EMPHASIS_PATTERN)) {
    if (match.index > last) {
      nodes.push(source.slice(last, match.index));
    }
    nodes.push(<strong key={`b-${match.index}`}>{match[1] ?? match[2]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    nodes.push(source.slice(last));
  }
  return nodes;
}
