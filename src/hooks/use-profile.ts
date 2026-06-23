import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type AppRole = "admin" | "staff" | "exhibitor" | "visitor" | "cliente";

export type ProfileWithRoles = {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string | null;
  preferred_language: "pt-BR" | "es";
  company_id: string | null;
  company_name: string | null;
  roles: AppRole[];
};

export function useProfile() {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id ?? "anon"],
    enabled: !!user && !authLoading,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<ProfileWithRoles | null> => {
      if (!user) return null;
      const [{ data: profile, error: profErr }, { data: rolesData }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, auth_user_id, full_name, company_id, preferred_language, is_active")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (profErr) throw profErr;
      if (!profile) return null;

      let company_name: string | null = null;
      if (profile.company_id) {
        const { data: company } = await supabase
          .from("companies")
          .select("trade_name")
          .eq("id", profile.company_id)
          .maybeSingle();
        company_name = company?.trade_name ?? null;
      }

      return {
        id: profile.id,
        auth_user_id: profile.auth_user_id!,
        full_name: profile.full_name,
        email: user.email ?? null,
        preferred_language: profile.preferred_language,
        company_id: profile.company_id,
        company_name,
        roles: (rolesData ?? []).map((r) => r.role as AppRole),
      };
    },
  });
}

export function hasRole(roles: AppRole[] | undefined, ...accepted: AppRole[]): boolean {
  if (!roles) return false;
  return roles.some((r) => accepted.includes(r));
}

const ROLE_PRIORITY: AppRole[] = ["admin", "staff", "cliente", "exhibitor", "visitor"];

export function getPrimaryRole(roles: AppRole[] | undefined): AppRole | null {
  if (!roles || roles.length === 0) return null;
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return null;
}