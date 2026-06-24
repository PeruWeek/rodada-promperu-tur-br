import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { button, container, footer, h1, main, small, text } from "./_shared";
import {
  TEMPLATE_COPY_DEFAULTS,
  interpolate,
  type CopyFields,
  type EmailLang,
} from "./copy-defaults";

const PREVIEW = {
  "pt-BR":
    "Seu cadastro foi concluído. Agora falta acessar a agenda e marcar suas reuniões.",
  es: "Tu registro fue completado. Ahora falta acceder a la agenda y agendar tus reuniones.",
} as const;

const HEADINGS = {
  "pt-BR": "Você ainda não agendou suas reuniões",
  es: "Aún no agendaste tus reuniones",
} as const;

const PLATFORM_BULLETS = {
  "pt-BR": [
    "agendar suas reuniões com as empresas participantes",
    "consultar os horários disponíveis",
    "acompanhar sua agenda atualizada",
    "revisar seus dados cadastrais",
    "baixar sua agenda em PDF",
  ],
  es: [
    "agendar tus reuniones con las empresas participantes",
    "consultar los horarios disponibles",
    "acompañar tu agenda actualizada",
    "revisar tus datos de registro",
    "descargar tu agenda en PDF",
  ],
} as const;

interface Props {
  language?: EmailLang;
  visitorName?: string;
  agendaUrl?: string;
  forgotPasswordUrl?: string;
  overrides?: Partial<CopyFields>;
}

const BookingReminderEmail = ({
  language = "pt-BR",
  visitorName,
  agendaUrl = "https://rodada.promperu.tur.br/agenda",
  forgotPasswordUrl = "https://rodada.promperu.tur.br/forgot-password",
  overrides,
}: Props) => {
  const lang = language === "es" ? "es" : "pt-BR";
  const defaults = TEMPLATE_COPY_DEFAULTS["booking-reminder"].copy[lang];
  const interpData = {
    visitorName: visitorName ?? "",
    agendaUrl,
    forgotPasswordUrl,
  };
  const greeting = interpolate(overrides?.greeting ?? defaults.greeting, interpData);
  const intro = interpolate(overrides?.intro ?? defaults.intro, interpData);
  const ctaLabel = interpolate(overrides?.ctaLabel ?? defaults.ctaLabel, interpData);
  const signature = interpolate(overrides?.signature ?? defaults.signature, interpData);

  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{PREVIEW[lang]}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{HEADINGS[lang]}</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>{intro}</Text>
          <Text style={text}>
            {lang === "es"
              ? "Tu agenda ya está disponible para acceso. Ingresa a la plataforma por el botón abajo y selecciona los horarios disponibles para armar tu programación de reuniones:"
              : "Sua agenda já está disponível para acesso. Entre na plataforma pelo botão abaixo e selecione os horários disponíveis para montar sua programação de reuniões:"}
          </Text>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href={agendaUrl} style={button}>
              {ctaLabel}
            </Button>
          </Section>
          <Text style={text}>
            {lang === "es" ? "En la plataforma podrás:" : "Na plataforma, você poderá:"}
          </Text>
          {PLATFORM_BULLETS[lang].map((b) => (
            <Text key={b} style={small}>
              • {b}
            </Text>
          ))}
          <Text style={text}>
            {lang === "es"
              ? "Recomendamos realizar tus agendamientos cuanto antes, ya que algunos horarios pueden dejar de estar disponibles durante el período de marcación."
              : "Recomendamos realizar seus agendamentos o quanto antes, pois alguns horários podem deixar de ficar disponíveis ao longo do período de marcação."}
          </Text>
          <Text style={text}>
            {lang === "es"
              ? "Si no recuerdas tu contraseña, utiliza el botón abajo para restablecer tu acceso:"
              : "Caso não se recorde da sua senha, utilize o botão abaixo para redefinir seu acesso:"}
          </Text>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href={forgotPasswordUrl} style={button}>
              {lang === "es" ? "Recuperar mi contraseña" : "Recuperar minha senha"}
            </Button>
          </Section>
          <Text style={small}>
            {lang === "es"
              ? "Si ya realizaste tus agendamientos recientemente, puedes ignorar este mensaje."
              : "Se você já realizou seus agendamentos recentemente, pode desconsiderar esta mensagem."}
          </Text>
          <Text style={small}>
            {lang === "es"
              ? "Si tienes dudas, ponte en contacto con la organización."
              : "Em caso de dúvidas, entre em contato com a organização."}
          </Text>
          <Text style={small}>WhatsApp (11) 99367-0633</Text>
          <Text style={footer}>{signature}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: BookingReminderEmail,
  subject: (data: Record<string, any>) => {
    const lang: EmailLang = data?.language === "es" ? "es" : "pt-BR";
    const fromOverride = typeof data?.overrideSubject === "string" && data.overrideSubject.trim().length > 0
      ? data.overrideSubject
      : TEMPLATE_COPY_DEFAULTS["booking-reminder"].subject[lang];
    return interpolate(fromOverride, data ?? {});
  },
  displayName: "Lembrete de agendamento",
  previewData: {
    language: "pt-BR",
    visitorName: "Maria",
    agendaUrl: "https://rodada.promperu.tur.br/agenda",
    forgotPasswordUrl: "https://rodada.promperu.tur.br/forgot-password",
  },
} satisfies TemplateEntry;