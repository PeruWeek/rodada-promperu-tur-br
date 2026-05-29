import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ptBR from "./pt-BR.json";
import es from "./es.json";

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        "pt-BR": { translation: ptBR },
        es: { translation: es },
      },
      fallbackLng: "pt-BR",
      supportedLngs: ["pt-BR", "es"],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "rp2026.lang",
        caches: ["localStorage"],
      },
    });
}

export default i18n;