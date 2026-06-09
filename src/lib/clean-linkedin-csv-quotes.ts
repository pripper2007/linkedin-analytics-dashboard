// LinkedIn's "Get a copy of your data" Shares.csv export wraps each
// paragraph of post commentary in literal `"` characters and uses a
// `""` line to mark blank-paragraph breaks. After RFC 4180 CSV
// unescaping (`""` → `"`), those quote characters end up embedded in
// the stored post_content — a post that reads cleanly on LinkedIn
// renders as `paragraph"`, `""`, `"next paragraph"` in the dashboard.
//
// This module strips that artifact. Conservative trigger: we only
// touch content that contains a line consisting solely of `""`, which
// is the unique marker of the LinkedIn-CSV bug and never appears in
// normal posts. Posts captured via the extension's Voyager parser
// (which reads JSON, not CSV) are unaffected and pass through.

export function cleanLinkedInCsvQuotes(content: string): string {
  if (!content) return content;
  // Trigger detection: a line that is exactly `""` is the unambiguous
  // signal. No human writes a paragraph that's just two quote
  // characters, so this won't fire on normal posts.
  if (!/(^|\n)""(\n|$)/.test(content)) return content;

  return content
    .split('\n')
    .map((line) => {
      // Blank-paragraph marker → real blank line.
      if (line === '""') return '';
      // Paragraph wrapped in matching quotes → strip both.
      if (line.length >= 2 && line.startsWith('"') && line.endsWith('"')) {
        return line.slice(1, -1);
      }
      // Asymmetric: first paragraph in the field has only a trailing `"`,
      // last paragraph only a leading `"`. Strip one side.
      if (line.endsWith('"') && !line.startsWith('"')) return line.slice(0, -1);
      if (line.startsWith('"') && !line.endsWith('"')) return line.slice(1);
      return line;
    })
    .join('\n');
}
