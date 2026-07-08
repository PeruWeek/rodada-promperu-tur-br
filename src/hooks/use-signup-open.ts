import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getSignupSettings } from "@/lib/signup-settings.functions";

/**
 * Lê o flag global `signup_settings.enabled`. Público — pode ser chamado
 * de páginas não autenticadas (home, header, /signup, /signup-exhibitor,
 * /login). Enquanto carrega, `enabled = true` para não flashar "encerrado"
 * no caso normal (inscrições abertas).
 */
export function useSignupOpen() {
  const fn = useServerFn(getSignupSettings);
  const q = useQuery({
    queryKey: ["signup-settings"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
  return {
    enabled: q.data?.enabled ?? true,
    isLoading: q.isLoading,
  };
}