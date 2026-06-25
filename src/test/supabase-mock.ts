/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal fluent supabase mock used in unit tests for server-fn _Impl handlers.
// Supports: from(table).select(...).eq().in().or().not().is().order().limit()
// .maybeSingle()/.single() and awaiting for arrays. Update/insert/delete are
// recorded but not executed against the dataset.

type Row = Record<string, any>;
type Dataset = Record<string, Row[]>;

type FilterKind = "eq" | "in" | "neq" | "is" | "not" | "or";
type Filter = { kind: FilterKind; column?: string; value?: any; raw?: any };

export type RecordedCall = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Filter[];
  payload?: any;
  columns?: string;
};

export type SupabaseMock = {
  client: any;
  calls: RecordedCall[];
  setDataset: (tables: Dataset) => void;
  resetCalls: () => void;
};

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === "eq") return row[f.column!] === f.value;
      if (f.kind === "neq") return row[f.column!] !== f.value;
      if (f.kind === "in") return Array.isArray(f.value) && f.value.includes(row[f.column!]);
      if (f.kind === "is") return row[f.column!] === f.value;
      if (f.kind === "not") {
        // .not("col","is",null) → col != null
        const [col, , val] = f.raw as [string, string, any];
        return row[col] !== val;
      }
      if (f.kind === "or") {
        // crude: not enforced (used for search). Always pass.
        return true;
      }
      return true;
    }),
  );
}

export function createSupabaseMock(initial: Dataset = {}): SupabaseMock {
  let dataset: Dataset = { ...initial };
  const calls: RecordedCall[] = [];

  function builder(table: string) {
    const filters: Filter[] = [];
    let op: RecordedCall["op"] = "select";
    let columns = "*";
    let payload: any = undefined;
    let limitN: number | null = null;
    let single = false;
    let maybeSingle = false;
    let head = false;
    let countMode: string | undefined;

    const record = () => calls.push({ table, op, filters: [...filters], payload, columns });

    const exec = (): { data: any; error: null; count?: number } => {
      record();
      const rows = applyFilters(dataset[table] ?? [], filters);
      if (op !== "select") return { data: payload ?? null, error: null };
      const limited = limitN ? rows.slice(0, limitN) : rows;
      if (head) {
        return { data: null, error: null, count: countMode ? rows.length : undefined };
      }
      if (single) return { data: limited[0] ?? null, error: null };
      if (maybeSingle) return { data: limited[0] ?? null, error: null };
      return { data: limited, error: null, count: countMode ? rows.length : undefined };
    };

    const api: any = {
      select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
        op = "select";
        if (cols) columns = cols;
        if (opts?.count) countMode = opts.count;
        if (opts?.head) head = true;
        return api;
      },
      insert: (data: any) => {
        op = "insert";
        payload = data;
        // Allow chained .select().single()
        return api;
      },
      update: (data: any) => {
        op = "update";
        payload = data;
        return api;
      },
      delete: () => {
        op = "delete";
        return api;
      },
      upsert: (data: any) => {
        op = "update";
        payload = data;
        return api;
      },
      eq: (column: string, value: any) => {
        filters.push({ kind: "eq", column, value });
        return api;
      },
      neq: (column: string, value: any) => {
        filters.push({ kind: "neq", column, value });
        return api;
      },
      in: (column: string, value: any[]) => {
        filters.push({ kind: "in", column, value });
        return api;
      },
      is: (column: string, value: any) => {
        filters.push({ kind: "is", column, value });
        return api;
      },
      not: (col: string, op2: string, val: any) => {
        filters.push({ kind: "not", raw: [col, op2, val] });
        return api;
      },
      or: (raw: string) => {
        filters.push({ kind: "or", raw });
        return api;
      },
      order: () => api,
      limit: (n: number) => {
        limitN = n;
        return api;
      },
      single: () => {
        single = true;
        return Promise.resolve(exec());
      },
      maybeSingle: () => {
        maybeSingle = true;
        return Promise.resolve(exec());
      },
      then: (onFulfilled: any, onRejected?: any) =>
        Promise.resolve(exec()).then(onFulfilled, onRejected),
    };
    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: null, error: null }),
  };

  return {
    client,
    calls,
    setDataset: (tables) => {
      dataset = { ...tables };
    },
    resetCalls: () => {
      calls.length = 0;
    },
  };
}

/** Build a user_roles dataset row list for a single user. */
export function rolesFor(userId: string, ...roles: string[]) {
  return roles.map((role) => ({ user_id: userId, role }));
}