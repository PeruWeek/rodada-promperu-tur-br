import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasRole, useProfile } from "./use-profile";

/**
 * Computes a 0-100 profile-completion score based on essential + complementary fields.
 * Essentials weigh more; complementary fields top off the remainder.
 */
export function useProfileCompletion() {
  const { data: profile } = useProfile();
  const isExhibitor = hasRole(profile?.roles, "exhibitor");
  const isVisitor = hasRole(profile?.roles, "visitor") || !isExhibitor;

  return useQuery({
    enabled: !!profile && !hasRole(profile?.roles, "staff", "admin"),
    queryKey: ["profile-completion", profile?.id, isExhibitor],
    queryFn: async () => {
      if (!profile) return { percent: 0, missing: [] as string[] };
      const [{ data: company }, { data: vis }, { data: exh }] = await Promise.all([
        profile.company_id
          ? supabase.from("companies").select("*").eq("id", profile.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("visitor_profiles").select("*").eq("profile_id", profile.id).maybeSingle(),
        supabase.from("exhibitor_profiles").select("*").eq("profile_id", profile.id).maybeSingle(),
      ]);

      const essentials: boolean[] = [
        !!profile.full_name?.trim(),
        !!company?.trade_name?.trim(),
        !!company?.city?.trim(),
      ];
      if (company?.country_code === "BR" || !company?.country_code) {
        essentials.push(!!company?.tax_id?.trim(), !!company?.state_code?.trim());
      }

      const complementary: boolean[] = [
        !!company?.website?.trim(),
        !!company?.whatsapp?.trim() || !!company?.phone?.trim(),
      ];
      if (isVisitor && vis) {
        complementary.push(
          !!vis.buyer_type,
          (vis.interests_segments ?? []).length > 0,
          (vis.interests_services ?? []).length > 0,
          !!vis.portfolio_pt?.trim() || !!vis.portfolio_es?.trim(),
        );
      }
      if (isExhibitor && exh) {
        complementary.push(
          (exh.segments ?? []).length > 0,
          (exh.services ?? []).length > 0,
          (exh.destinations ?? []).length > 0,
          !!exh.pitch_pt?.trim() || !!exh.pitch_es?.trim(),
        );
      }

      const essentialScore = essentials.filter(Boolean).length / Math.max(essentials.length, 1);
      const complementaryScore =
        complementary.length > 0
          ? complementary.filter(Boolean).length / complementary.length
          : 1;
      // Essentials = 70%, complementary = 30%
      const percent = Math.round(essentialScore * 70 + complementaryScore * 30);
      return { percent, missing: [] as string[] };
    },
  });
}