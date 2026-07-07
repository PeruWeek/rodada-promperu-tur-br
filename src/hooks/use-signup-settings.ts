import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getSignupSettings } from "@/lib/signup-settings.functions";

export function useSignupSettings() {
  const getFn = useServerFn(getSignupSettings);

  return useQuery({
    queryKey: ["signup-settings"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });
}
