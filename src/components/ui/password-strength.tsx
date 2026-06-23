import * as React from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  type PasswordChecks,
  checkPassword,
  passwordStrength,
} from "@/lib/password-strength";

type Props = {
  value: string;
  className?: string;
};

const CRITERIA: Array<{ key: keyof PasswordChecks; i18n: string }> = [
  { key: "minLength", i18n: "auth.passwordCriteria.minLength" },
  { key: "hasLower",  i18n: "auth.passwordCriteria.hasLower" },
  { key: "hasUpper",  i18n: "auth.passwordCriteria.hasUpper" },
  { key: "hasNumber", i18n: "auth.passwordCriteria.hasNumber" },
  { key: "hasSymbol", i18n: "auth.passwordCriteria.hasSymbol" },
  { key: "notCommon", i18n: "auth.passwordCriteria.notCommon" },
];

export function PasswordStrength({ value, className }: Props) {
  const { t } = useTranslation();
  const checks = checkPassword(value);
  const strength = passwordStrength(value);

  const barColor =
    strength === "strong"
      ? "bg-emerald-500"
      : strength === "medium"
      ? "bg-amber-500"
      : strength === "weak"
      ? "bg-destructive"
      : "bg-muted";
  const barWidth =
    strength === "strong" ? "w-full"
    : strength === "medium" ? "w-2/3"
    : strength === "weak" ? "w-1/3"
    : "w-0";
  const label =
    strength === "empty" ? "" : t(`auth.passwordStrength.${strength}`);
  const labelColor =
    strength === "strong" ? "text-emerald-600 dark:text-emerald-400"
    : strength === "medium" ? "text-amber-600 dark:text-amber-400"
    : strength === "weak" ? "text-destructive"
    : "text-muted-foreground";

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full transition-all", barColor, barWidth)} />
      </div>
      {label && (
        <p className={cn("text-xs font-medium", labelColor)}>
          {t("auth.passwordStrength.label")}: {label}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        {CRITERIA.map(({ key, i18n }) => {
          const ok = checks[key];
          return (
            <li
              key={key}
              className={cn(
                "flex items-center gap-1.5",
                ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 opacity-60" />}
              <span>{t(i18n)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}