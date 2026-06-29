import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TAXONOMY, type TaxonomyKey } from "@/lib/taxonomy";

interface Props {
  taxonomyKey: TaxonomyKey;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function MultiSelectChips({ taxonomyKey, value, onChange, disabled }: Props) {
  const { i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt") as "pt" | "es";
  const items = TAXONOMY[taxonomyKey];

  const toggle = (v: string) => {
    if (disabled) return;
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = value.includes(item.value);
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => toggle(item.value)}
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:border-primary"
                : "border-border bg-background text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary",
              disabled && "opacity-60 cursor-not-allowed hover:bg-background hover:text-foreground hover:border-border"
            )}
          >
            {active && <Check size={14} />}
            {lang === "es" ? item.es : item.pt}
          </button>
        );
      })}
    </div>
  );
}
