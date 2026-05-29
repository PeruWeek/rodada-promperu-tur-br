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
import {
  button,
  card,
  container,
  footer,
  formatSlot,
  h1,
  main,
  small,
  text,
} from "./_shared";

const SITE_NAME = "Rodada Peru 2026";

interface Props {
  language?: "pt-BR" | "es";
  visitorName?: string;
  exhibitorCompany?: string;
  tableNumber?: number | string;
  slotStart?: string;
  slotEnd?: string;
  agendaUrl?: string;
}

const T = {
  "pt-BR": {
    preview: (c: string) => `Sua reunião com ${c} está confirmada`,
    h1: "Reunião confirmada",
    hi: (n?: string) => (n ? `Olá, ${n}!` : "Olá!"),
    intro: "Sua reunião foi agendada com sucesso. Aqui estão os detalhes:",
    company: "Expositor",
    table: "Mesa",
    when: "Horário",
    cta: "Ver minha agenda",
    tip: "Chegue alguns minutos antes para não perder o início. Reuniões têm 15 minutos.",
    footer: `Você está recebendo este e-mail porque agendou uma reunião na ${SITE_NAME}.`,
  },
  es: {
    preview: (c: string) => `Tu reunión con ${c} está confirmada`,
    h1: "Reunión confirmada",
    hi: (n?: string) => (n ? `¡Hola, ${n}!` : "¡Hola!"),
    intro: "Tu reunión fue agendada con éxito. Estos son los detalles:",
    company: "Expositor",
    table: "Mesa",
    when: "Horario",
    cta: "Ver mi agenda",
    tip: "Llega unos minutos antes para no perder el inicio. Las reuniones duran 15 minutos.",
    footer: `Recibes este correo porque agendaste una reunión en la ${SITE_NAME}.`,
  },
} as const;

const MeetingConfirmationEmail = ({
  language = "pt-BR",
  visitorName,
  exhibitorCompany = "—",
  tableNumber = "—",
  slotStart,
  slotEnd,
  agendaUrl = "https://rodada.promperu.tur.br/agenda",
}: Props) => {
  const lang = language === "es" ? "es" : "pt-BR";
  const t = T[lang];
  const when =
    slotStart && slotEnd ? formatSlot(slotStart, slotEnd, lang) : "—";
  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{t.preview(exhibitorCompany)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.h1}</Heading>
          <Text style={text}>{t.hi(visitorName)}</Text>
          <Text style={text}>{t.intro}</Text>
          <Section style={card}>
            <Text style={small}>
              <strong>{t.company}:</strong> {exhibitorCompany}
            </Text>
            <Text style={small}>
              <strong>{t.table}:</strong> {tableNumber}
            </Text>
            <Text style={small}>
              <strong>{t.when}:</strong> {when}
            </Text>
          </Section>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href={agendaUrl} style={button}>
              {t.cta}
            </Button>
          </Section>
          <Text style={small}>{t.tip}</Text>
          <Text style={footer}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: MeetingConfirmationEmail,
  subject: (d: Record<string, any>) => {
    const lang = d?.language === "es" ? "es" : "pt-BR";
    const c = d?.exhibitorCompany ?? "";
    return lang === "es"
      ? `Reunión confirmada — ${c}`
      : `Reunião confirmada — ${c}`;
  },
  displayName: "Meeting confirmation",
  previewData: {
    language: "pt-BR",
    visitorName: "Maria",
    exhibitorCompany: "Andean Tours SAC",
    tableNumber: 12,
    slotStart: "2026-07-08T13:00:00Z",
    slotEnd: "2026-07-08T13:15:00Z",
    agendaUrl: "https://rodada.promperu.tur.br/agenda",
  },
} satisfies TemplateEntry;