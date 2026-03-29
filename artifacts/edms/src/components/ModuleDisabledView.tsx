import { useI18n } from "@/lib/i18n";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export function ModuleDisabledView() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-5">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">{t("moduleNotAvailable")}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{t("moduleNotAvailableDesc")}</p>
      <Button variant="outline" onClick={() => navigate("/")}>Go to Dashboard</Button>
    </div>
  );
}
