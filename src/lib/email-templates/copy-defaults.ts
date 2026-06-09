// Default copy/labels per template per language. Mirrored by the React
// template components AND by the admin UI (so admins see the default
// text when no override exists).

export type EmailLang = "pt-BR" | "es";

export interface CopyFields {
  greeting: string;
  intro: string;
  outro: string;
  ctaLabel: string;
  signature: string;
}

export interface TemplateCopyDefaults {
  fromName: string;
  subject: Record<EmailLang, string>;
  copy: Record<EmailLang, CopyFields>;
}

export const DEFAULT_FROM_NAME = "Rodada de Negócios PromPerú";
const SITE_NAME = "Rodada de Negócios Promperu 2026";

export const TEMPLATE_COPY_DEFAULTS: Record<string, TemplateCopyDefaults> = {
  "meeting-confirmation": {
    fromName: DEFAULT_FROM_NAME,
    subject: {
      "pt-BR": "Reunião confirmada — {{exhibitorCompany}}",
      es: "Reunión confirmada — {{exhibitorCompany}}",
    },
    copy: {
      "pt-BR": {
        greeting: "Olá, {{visitorName}}!",
        intro: "Sua reunião foi agendada com sucesso. Aqui estão os detalhes:",
        outro:
          "Chegue alguns minutos antes para não perder o início. Reuniões têm 15 minutos.",
        ctaLabel: "Ver minha agenda",
        signature: `Você está recebendo este e-mail porque agendou uma reunião na ${SITE_NAME}.`,
      },
      es: {
        greeting: "¡Hola, {{visitorName}}!",
        intro: "Tu reunión fue agendada con éxito. Estos son los detalles:",
        outro:
          "Llega unos minutos antes para no perder el inicio. Las reuniones duran 15 minutos.",
        ctaLabel: "Ver mi agenda",
        signature: `Recibes este correo porque agendaste una reunión en la ${SITE_NAME}.`,
      },
    },
  },
  "meeting-cancelled": {
    fromName: DEFAULT_FROM_NAME,
    subject: {
      "pt-BR": "Reunião cancelada — {{exhibitorCompany}}",
      es: "Reunión cancelada — {{exhibitorCompany}}",
    },
    copy: {
      "pt-BR": {
        greeting: "Olá, {{visitorName}}!",
        intro: "Sua reunião foi cancelada. Resumo do que estava agendado:",
        outro: "O slot voltou a ficar disponível para outros visitantes.",
        ctaLabel: "Agendar outro horário",
        signature: `Você está recebendo este e-mail porque tinha uma reunião agendada na ${SITE_NAME}.`,
      },
      es: {
        greeting: "¡Hola, {{visitorName}}!",
        intro: "Tu reunión fue cancelada. Resumen de lo que estaba agendado:",
        outro: "El espacio volvió a quedar disponible para otros visitantes.",
        ctaLabel: "Agendar otro horario",
        signature: `Recibes este correo porque tenías una reunión agendada en la ${SITE_NAME}.`,
      },
    },
  },
};

export const TEMPLATE_DISPLAY_NAMES: Record<string, string> = {
  "meeting-confirmation": "Confirmação de reunião",
  "meeting-cancelled": "Cancelamento de reunião",
};

// Placeholders available per template (shown in the admin UI).
export const TEMPLATE_PLACEHOLDERS: Record<string, string[]> = {
  "meeting-confirmation": [
    "visitorName",
    "exhibitorCompany",
    "tableNumber",
    "slotStart",
    "slotEnd",
  ],
  "meeting-cancelled": [
    "visitorName",
    "exhibitorCompany",
    "tableNumber",
    "slotStart",
    "slotEnd",
  ],
};

// Sanitize + interpolate {{var}} placeholders into a template string.
// Strips angle brackets from inserted values so overrides cannot inject HTML.
export function interpolate(
  tpl: string,
  data: Record<string, unknown>,
): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key) => {
    const v = data[key];
    if (v == null) return "";
    return String(v).replace(/[<>]/g, "");
  });
}

export type OverrideField =
  | "from_name"
  | "subject_pt"
  | "subject_es"
  | "greeting_pt"
  | "greeting_es"
  | "intro_pt"
  | "intro_es"
  | "outro_pt"
  | "outro_es"
  | "cta_label_pt"
  | "cta_label_es"
  | "signature_pt"
  | "signature_es";

export const OVERRIDE_FIELDS: OverrideField[] = [
  "from_name",
  "subject_pt",
  "subject_es",
  "greeting_pt",
  "greeting_es",
  "intro_pt",
  "intro_es",
  "outro_pt",
  "outro_es",
  "cta_label_pt",
  "cta_label_es",
  "signature_pt",
  "signature_es",
];