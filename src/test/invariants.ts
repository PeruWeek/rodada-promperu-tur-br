export function assertNoSemAgendamento(
  rows: Array<{ scheduling_status?: string | null }>,
) {
  const leaked = rows.filter((r) => r.scheduling_status === "sem_agendamento");
  if (leaked.length > 0) {
    throw new Error(
      `[cliente-auth] Leak: ${leaked.length} registro(s) com scheduling_status="sem_agendamento" ` +
        `vazaram para o caller cliente: ${JSON.stringify(leaked)}`,
    );
  }
}

export async function expectClienteWriteBlocked(
  label: string,
  fn: () => Promise<unknown>,
) {
  let result: unknown;
  let threw: unknown = null;
  try {
    result = await fn();
  } catch (e) {
    threw = e;
  }
  if (threw == null) {
    throw new Error(
      `[cliente-auth] Mutation "${label}" retornou sucesso para caller cliente ` +
        `(resultado: ${JSON.stringify(result)}). Toda mutation deve throw Forbidden.`,
    );
  }
  const msg = String((threw as Error).message ?? threw);
  if (!/forbidden/i.test(msg)) {
    throw new Error(
      `[cliente-auth] Mutation "${label}" lançou erro inesperado para cliente: ${msg}. ` +
        `Esperado: mensagem contendo "Forbidden".`,
    );
  }
}