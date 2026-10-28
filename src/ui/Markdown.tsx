import { Fragment } from "react";
import { H2 } from "@/ui/Prose";

/**
 * Renders the small Markdown subset used by CHANGELOG.md (server component, runs at build time):
 * ## and ### headings, paragraphs, "-" lists nested by two-space indents, ---, and inline
 * **bold**, *italic*, `code` and [links](url). A leading # heading is skipped because the page shows its own title.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^# /.test(line)) {
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(<H2 key={i}>{inline(line.slice(3))}</H2>);
      i++;
    } else if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={i} className="mt-2 font-display text-2xl font-black text-amber">
          {inline(line.slice(4))}
        </h3>,
      );
      i++;
    } else if (/^-{3,}\s*$/.test(line)) {
      blocks.push(<hr key={i} className="border-line" />);
      i++;
    } else if (/^\s*- /.test(line)) {
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = /^(\s*)- (.*)$/.exec(lines[i]);
        if (m) items.push({ depth: Math.floor(m[1].length / 2), text: m[2] });
        else items[items.length - 1].text += " " + lines[i].trim(); // wrapped continuation line
        i++;
      }
      blocks.push(<Fragment key={i}>{list(items, 0, { at: 0 })}</Fragment>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\s*- |-{3,}\s*$)/.test(lines[i])) para.push(lines[i++].trim());
      blocks.push(<p key={i}>{inline(para.join(" "))}</p>);
    }
  }
  return <>{blocks}</>;
}

function list(items: { depth: number; text: string }[], depth: number, pos: { at: number }): React.ReactNode {
  const out: React.ReactNode[] = [];
  while (pos.at < items.length && items[pos.at].depth >= depth) {
    const item = items[pos.at++];
    const children = pos.at < items.length && items[pos.at].depth > depth ? list(items, depth + 1, pos) : null;
    out.push(
      <li key={pos.at}>
        {inline(item.text)}
        {children}
      </li>,
    );
  }
  return <ul className={`flex list-disc flex-col gap-1.5 pl-6 marker:text-steel ${depth > 0 ? "mt-1.5" : ""}`}>{out}</ul>;
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = m.index;
    if (m[1] !== undefined)
      out.push(
        <strong key={k} className="font-semibold text-net">
          {inline(m[1])}
        </strong>,
      );
    else if (m[2] !== undefined) out.push(<em key={k}>{inline(m[2])}</em>);
    else if (m[3] !== undefined)
      out.push(
        <code key={k} className="rounded bg-deck px-1 py-0.5 text-[0.9em]">
          {m[3]}
        </code>,
      );
    else
      out.push(
        <a key={k} className="text-amber underline" href={m[5]}>
          {m[4]}
        </a>,
      );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
