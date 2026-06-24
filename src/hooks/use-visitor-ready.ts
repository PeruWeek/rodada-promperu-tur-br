import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasRole, useProfile } from "./use-profile";

/**
 * "Visitor ready" = perfil de visitante com dados mínimos para começar
 * a agendar reuniões. Usado tanto para esconder a mensagem
 * "Complete seu perfil…" no dashboard quanto para disparar
 * `lead_signup_completed` no Mautic na transição real de conclusão.
 *
 * Critério (alinhado com a RPC `complete_buyer_signup` do banco):
 *   - `visitor_profiles.signup_completed_at IS NOT NULL`   (caminho wizard)
 *     OU
 *   - empresa com trade_name + city                        (caminho /profile)
 *
 * `buyer_types` é opcional e NÃO entra no critério — o usuário pode
 * concluir o cadastro sem preencher esse campo.
 *
 * Observação: o wizard de signup NÃO coleta `interests_destinations` —
 * por isso esse campo não entra no critério. A RPC marca
 * `signup_completed_at` quando o wizard conclui com sucesso.
 */
export function useVisitorReady() {
  const { data: profile } = useProfile();
  const isExhibitor = hasRole(profile?.roles, "exhibitor");
  const isVisitor = hasRole(profile?.roles, "visitor") || !isExhibitor;

  return useQuery({
    enabled: !!profile && isVisitor && !hasRole(profile?.roles, "staff", "admin"),
    queryKey: ["visitor-ready", profile?.id],
    queryFn: async () => {
      if (!profile) return { ready: false };
      const [{ data: company }, { data: vis }] = await Promise.all([
        profile.company_id
          ? supabase.from("companies").select("trade_name, city").eq("id", profile.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("visitor_profiles")
          .select("buyer_types, interests_segments, signup_completed_at")
          .eq("profile_id", profile.id)
          .maybeSingle(),
      ]);
      const wizardCompleted = !!vis?.signup_completed_at;
      const profileFilled =
        !!company?.trade_name?.trim() &&
        !!company?.city?.trim();
      const ready = wizardCompleted || profileFilled;
      console.info("[visitor-ready] computed", {
        profile_id: profile.id,
        trade_name: company?.trade_name ?? null,
        city: company?.city ?? null,
        buyer_types_len: vis?.buyer_types?.length ?? 0,
        segments_len: vis?.interests_segments?.length ?? 0,
        signup_completed_at: vis?.signup_completed_at ?? null,
        ready,
      });
      return { ready };
    },
  });
}