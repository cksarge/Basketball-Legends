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
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initial: string;
  highlight?: (row: T) => boolean;
  label: string;
}) {
  const [sort, setSort] = useState({ key: initial, asc: false });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    const dir = sort.asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.value(a),
        y = col.value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, columns, sort]);
  const onSort = (c: Column<T>) => setSort((s) => (s.key === c.key ? { key: c.key, asc: !s.asc } : { key: c.key, asc: !!c.text }));
  return (
    <div className="overflow-x-auto">
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
          {sorted.map((r) => (
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
    </div>
  );
}
