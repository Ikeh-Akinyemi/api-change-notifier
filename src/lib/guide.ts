// new entries go right under this line, which keeps the guide newest first
export const ENTRY_MARKER = "<!-- api-change-notifier: new entries go below this line -->";

export function addGuideEntry(guide: string, entry: { date: string; title: string; prNumber: number; markdown: string }) {
  const section = `## ${entry.date}: ${entry.title}\n\nChanged in #${entry.prNumber}.\n\n${entry.markdown.trim()}\n`;

  if (guide.includes(ENTRY_MARKER)) {
    return guide.replace(ENTRY_MARKER, `${ENTRY_MARKER}\n\n${section}`);
  }

  // guide without a marker yet: put one above the first entry, or at the end
  const block = `${ENTRY_MARKER}\n\n${section}`;
  if (!guide.trim()) return `# Migration guide\n\n${block}`;

  const firstEntry = guide.search(/^## /m);
  if (firstEntry === -1) return `${guide.trimEnd()}\n\n${block}`;
  return `${guide.slice(0, firstEntry)}${block}\n${guide.slice(firstEntry)}`;
}
