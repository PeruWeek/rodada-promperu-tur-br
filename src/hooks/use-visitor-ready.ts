import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasRole, useProfile } from "./use-profile";

/**
 * "Visitor ready" = cadastro CONCLUÍDO segundo a regra central
 * (`src/lib/registration-requirements.ts`).
 *
 * Fonte única da verdade: `visitor_profiles.signup_completed_at IS NOT NULL`.
 * Tanto a RPC `complete_buyer_signup` quanto o trigger
 * `enforce_visitor_signup_completion_fields` garantem que esse timestamp só
 * é gravado quando TODOS os obrigatórios (contato + empresa + consentimentos)
 * estão preenchidos. Logo, o front-end pode confiar exclusivamente nesse
 * campo para distinguir pendente vs completo.
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
      const { data: vis } = await supabase
        .from("visitor_profiles")
        .select("signup_completed_at")
        .eq("profile_id", profile.id)
        .maybeSingle();
      const ready = !!vis?.signup_completed_at;
      console.info("[visitor-ready] computed", {
        profile_id: profile.id,
        signup_completed_at: vis?.signup_completed_at ?? null,
        ready,
      });
      return { ready };
    },
  });
}