import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Standard list summary used across admin tabs.
 *
 * UX contract (must stay consistent system-wide):
 *
 * - Always render an explicit "Mostrando X de Y itens" line at the top of
 *   every list, respecting active filters/search/permission.
 * - When `total <= threshold` (default 50), pagination MUST NOT be rendered:
 *   the entire filtered set is shown in a single list.
 * - When `total > threshold`, the consumer is responsible for slicing rows
 *   and may render `<ListPagination />` with a 25/50/100 page-size selector.
 */
export const LIST_PAGINATION_THRESHOLD = 50;
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export function ListSummary({
  visible,
  total,
  noun,
  nounPlural,
}: {
  visible: number;
  total: number;
  /** Singular noun, e.g. "empresa" / "inscrito" / "agendamento". */
  noun: string;
  /** Plural noun, e.g. "empresas" / "inscritos" / "agendamentos". */
  nounPlural: string;
}) {
  const label = total === 1 ? noun : nounPlural;
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid="list-summary"
      aria-live="polite"
    >
      Mostrando {visible} de {total} {label}
    </p>
  );
}

/**
 * Standard pagination strip. Render only when `total > LIST_PAGINATION_THRESHOLD`.
 * Mirrors the summary, so the user always sees how the visible slice maps to
 * the full filtered set.
 */
export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun,
  nounPlural,
}: {
  page: number;
  pageSize: PageSizeOption;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: PageSizeOption) => void;
  noun: string;
  nounPlural: string;
}) {
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );
  const safePage = Math.min(page, pageCount);
  const visibleFrom = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const visibleTo = Math.min(safePage * pageSize, total);
  const label = total === 1 ? noun : nounPlural;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span data-testid="list-summary">
        Mostrando {visibleFrom}–{visibleTo} de {total} {label}
      </span>
      <div className="flex items-center gap-2">
        <span>Itens por página</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v) as PageSizeOption)}
        >
          <SelectTrigger className="h-7 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          ‹
        </Button>
        <span className="px-2 py-1">
          {safePage} / {pageCount}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={safePage >= pageCount}
          onClick={() => onPageChange(safePage + 1)}
        >
          ›
        </Button>
      </div>
    </div>
  );
}