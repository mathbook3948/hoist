import type { ReactNode } from "react";
import { cn } from "cn";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Empty, EmptyHeader, EmptyDescription } from "./ui/empty";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  emptyMessage,
  selectedKey,
  onRowClick,
  disabled = false,
  className,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage: string;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <Table
        aria-label={label}
        className={cn("min-w-3xl table-fixed", className)}
      >
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                scope="col"
                className={column.className}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                className={
                  onRowClick && !disabled ? "cursor-pointer" : undefined
                }
                onClick={(event) => {
                  if (
                    !disabled &&
                    !(event.target as Element).closest(
                      "a, button, input, select, textarea, [role=button]",
                    )
                  )
                    onRowClick?.(row);
                }}
                data-state={
                  rowKey(row) === selectedKey ? "selected" : undefined
                }
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn("text-left", column.className)}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                <Empty>
                  <EmptyHeader>
                    <EmptyDescription>{emptyMessage}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
