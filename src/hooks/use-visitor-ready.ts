import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasRole, useProfile } from "./use-profile";

/**
 * "Visitor ready" = perfil de visitante com dados mínimos para começar
 * a agendar reuniões. Usado tanto para esconder a mensagem
 * "Complete seu perfil…" no dashboard quanto para disparar
 * `lead_signup_completed` no Mautic na transição real de conclusão.
 *
 * Critério (alinhado com o onboarding do buyer):
 *   - empresa: trade_name + city preenchidos
 *   - visitor_profiles: buyer_types, interests_segments e
 *     interests_destinations com pelo menos 1 item
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
          .select("buyer_types, interests_segments, interests_destinations")
          .eq("profile_id", profile.id)
          .maybeSingle(),
      ]);
      const ready =
        !!company?.trade_name?.trim() &&
        !!company?.city?.trim() &&
        (vis?.buyer_types?.length ?? 0) > 0 &&
        (vis?.interests_segments?.length ?? 0) > 0 &&
        (vis?.interests_destinations?.length ?? 0) > 0;
      return { ready };
    },
  });
}