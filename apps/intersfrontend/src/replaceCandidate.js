// Replaces one row with the candidate the server returned. Other rows stay as they were.
export function replaceCandidate(candidates, updated) {
  return candidates.map((row) => (row.id === updated.id ? updated : row));
}
