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
  "booking-reminder": {
    fromName: DEFAULT_FROM_NAME,
    subject: {
      "pt-BR": "Você ainda não agendou suas reuniões na plataforma",
      es: "Aún no agendaste tus reuniones en la plataforma",
    },
    copy: {
      "pt-BR": {
        greeting: "Olá, {{visitorName}}!",
        intro:
          "Seu cadastro no PERU MICE Networking evento foi concluído com sucesso, mas identificamos que você ainda não agendou suas reuniões na plataforma.",
        outro: "",
        ctaLabel: "Agendar reuniões",
        signature: "Atenciosamente, Equipe PERU MICE Networking evento",
      },
      es: {
        greeting: "¡Hola, {{visitorName}}!",
        intro:
          "Tu registro en el PERU MICE Networking evento fue completado con éxito, pero identificamos que todavía no agendaste tus reuniones en la plataforma.",
        outro: "",
        ctaLabel: "Agendar reuniones",
        signature: "Atentamente, Equipo PERU MICE Networking evento",
      },
    },
  },
};

TEMPLATE_COPY_DEFAULTS["postevent-qa"] = {
  fromName: DEFAULT_FROM_NAME,
  subject: {
    "pt-BR": "Obrigado por participar — confirme suas reuniões",
    es: "Gracias por participar — confirma tus reuniones",
  },
  copy: {
    "pt-BR": {
      greeting: "Olá, {{visitorName}}!",
      intro:
        "Obrigado por participar da Rodada de Negócios. Para fecharmos o relatório do evento, confirme abaixo com quais empresas você realmente se reuniu.",
      outro: "Basta 1 minuto. Você pode marcar como “não informar agora” em qualquer reunião.",
      ctaLabel: "Confirmar minhas reuniões",
      signature: `Você está recebendo este e-mail porque participou da ${SITE_NAME}.`,
    },
    es: {
      greeting: "¡Hola, {{visitorName}}!",
      intro:
        "Gracias por participar de la Rueda de Negocios. Para cerrar el reporte del evento, confirma abajo con qué empresas realmente te reuniste.",
      outro: "Solo 1 minuto. Puedes marcar como “no informar ahora” en cualquier reunión.",
      ctaLabel: "Confirmar mis reuniones",
      signature: `Recibes este correo porque participaste en la ${SITE_NAME}.`,
    },
  },
};

// Agenda delivery (admin campaign) — content per campaign is snapshotted;
// only greeting/subject/signature use these defaults when the admin does
// not override them.
TEMPLATE_COPY_DEFAULTS["agenda-delivery"] = {
  fromName: DEFAULT_FROM_NAME,
  subject: {
    "pt-BR": "Sua agenda — {{eventName}}",
    es: "Tu agenda — {{eventName}}",
  },
  copy: {
    "pt-BR": {
      greeting: "Olá, {{visitorName}}!",
      intro:
        "Sua agenda pessoal está pronta. Clique no botão abaixo para baixar o PDF com todos os seus horários confirmados.",
      outro: "",
      ctaLabel: "Baixar minha agenda",
      signature: `Você está recebendo este e-mail porque participa da ${SITE_NAME}.`,
    },
    es: {
      greeting: "¡Hola, {{visitorName}}!",
      intro:
        "Tu agenda personal está lista. Haz clic en el botón para descargar el PDF con todos tus horarios confirmados.",
      outro: "",
      ctaLabel: "Descargar mi agenda",
      signature: `Recibes este correo porque participas de la ${SITE_NAME}.`,
    },
  },
};

export const TEMPLATE_DISPLAY_NAMES: Record<string, string> = {
  "meeting-confirmation": "Confirmação de reunião",
  "meeting-cancelled": "Cancelamento de reunião",
  "booking-reminder": "Lembrete de agendamento",
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
  "booking-reminder": ["visitorName", "agendaUrl", "forgotPasswordUrl"],
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