"use client";
import { useMemo, useState } from "react";

export interface Column<T> {
  key: string;
  label: string;
  /** The value sorted on, and shown unless `render` is set. */
  value: (row: T) => number | string;
  render?: (row: T) => React.ReactNode;
  /** Left-aligned text columns; numbers sit on the right. */
  text?: boolean;
}

/** A table sorted by clicking its headers. Numbers sort high to low first, text A to Z. */
export function SortTable<T>({
  rows,
  columns,
  rowKey,
  initial,
  highlight,
  label,
  filter,
  limit,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initial: string;
  highlight?: (row: T) => boolean;
  label: string;
  /** The text a filter box matches against. With it, the table gets a filter box. */
  filter?: (row: T) => string;
  /** Shows only the first rows after sorting and filtering, for very long tables. */
  limit?: number;
}) {
  const [sort, setSort] = useState({ key: initial, asc: false });
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    const dir = sort.asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.value(a),
        y = col.value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, columns, sort]);
  const q = query.trim().toLowerCase();
  const matching = filter && q ? sorted.filter((r) => filter(r).toLowerCase().includes(q)) : sorted;
  const shown = limit ? matching.slice(0, limit) : matching;
  const onSort = (c: Column<T>) => setSort((s) => (s.key === c.key ? { key: c.key, asc: !s.asc } : { key: c.key, asc: !!c.text }));
  return (
    <div className="overflow-x-auto">
      {filter && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          aria-label={`Filter ${label}`}
          className="mb-2 w-full max-w-xs rounded-[var(--radius-chip)] bg-navy px-3 py-1.5 text-sm text-net ring-1 ring-line placeholder:text-steel"
        />
      )}
      <table className="w-full text-sm tabular-nums" aria-label={label}>
        <thead className="text-steel">
          <tr>
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort.key === c.key ? (sort.asc ? "ascending" : "descending") : "none"} className={c.text ? "text-left" : "text-right"}>
                <button onClick={() => onSort(c)} className={`py-1 font-semibold hover:text-net ${sort.key === c.key ? "text-amber" : ""}`}>
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)} className={`border-t border-line/60 ${highlight?.(r) ? "text-amber" : ""}`}>
              {columns.map((c) => (
                <td key={c.key} className={`py-1.5 ${c.text ? "text-left" : "text-right"}`}>
                  {c.render ? c.render(r) : c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length < matching.length && (
        <p className="mt-2 text-xs text-steel">
          Showing the top {shown.length} of {matching.length}.{filter ? " Filter to find the rest." : ""}
        </p>
      )}
    </div>
  );
}
