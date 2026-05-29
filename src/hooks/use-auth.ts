import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
  });

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, user: session?.user ?? null, loading: false });
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ session, user: session?.user ?? null, loading: false });
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}