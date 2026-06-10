import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = i18n.language?.startsWith("es") ? "es" : "pt-BR";

  const change = async (lng: "pt-BR" | "es") => {
    if (lng === current) return;
    // Apply UI change immediately so the click always reflects, even if the
    // profile row isn't ready yet or the network call hangs.
    void i18n.changeLanguage(lng);
    try {
      localStorage.setItem("rp2026.lang", lng);
    } catch {}
    // Fire-and-forget persistence; don't block the UI.
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          await supabase
            .from("profiles")
            .update({ preferred_language: lng })
            .eq("auth_user_id", data.user.id);
        }
      } catch {
        // ignore; local language already applied
      }
    })();
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-card text-xs font-semibold",
        className,
      )}
      role="group"
      aria-label="Language switcher"
    >
      <button
        type="button"
        onClick={() => change("pt-BR")}
        className={cn(
          "px-3 py-1.5 rounded-full transition-colors",
          current === "pt-BR"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        PT
      </button>
      <button
        type="button"
        onClick={() => change("es")}
        className={cn(
          "px-3 py-1.5 rounded-full transition-colors",
          current === "es"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        ES
      </button>
    </div>
  );
}