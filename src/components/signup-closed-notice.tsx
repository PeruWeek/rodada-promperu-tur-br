import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type SignupClosedNoticeProps = {
  compact?: boolean;
};

export function SignupClosedNotice({ compact = false }: SignupClosedNoticeProps) {
  const { t } = useTranslation();

  return (
    <div className={`rounded-lg border bg-card ${compact ? "p-4" : "p-6"} space-y-3`}>
      <h1 className={`${compact ? "text-lg" : "text-2xl"} font-bold`}>
        {t("auth.signupClosedTitle")}
      </h1>
      <p className="text-sm text-muted-foreground">{t("auth.signupClosedBody")}</p>
      <Button asChild>
        <Link to="/login">{t("landing.ctaLogin")}</Link>
      </Button>
    </div>
  );
}
