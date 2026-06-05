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

const SITE_NAME = "Rodada de Negócios Promperu 2026";

interface Props {
  language?: "pt-BR" | "es";
  visitorName?: string;
  exhibitorCompany?: string;
  tableNumber?: number | string;
  slotStart?: string;
  slotEnd?: string;
  exploreUrl?: string;
}

const T = {
  "pt-BR": {
    preview: (c: string) => `Sua reunião com ${c} foi cancelada`,
    h1: "Reunião cancelada",
    hi: (n?: string) => (n ? `Olá, ${n}!` : "Olá!"),
    intro: "Sua reunião foi cancelada. Resumo do que estava agendado:",
    company: "Expositor",
    table: "Mesa",
    when: "Horário",
    cta: "Agendar outro horário",
    tip: "O slot voltou a ficar disponível para outros visitantes.",
    footer: `Você está recebendo este e-mail porque tinha uma reunião agendada na ${SITE_NAME}.`,
  },
  es: {
    preview: (c: string) => `Tu reunión con ${c} fue cancelada`,
    h1: "Reunión cancelada",
    hi: (n?: string) => (n ? `¡Hola, ${n}!` : "¡Hola!"),
    intro: "Tu reunión fue cancelada. Resumen de lo que estaba agendado:",
    company: "Expositor",
    table: "Mesa",
    when: "Horario",
    cta: "Agendar otro horario",
    tip: "El espacio volvió a quedar disponible para otros visitantes.",
    footer: `Recibes este correo porque tenías una reunión agendada en la ${SITE_NAME}.`,
  },
} as const;

const MeetingCancelledEmail = ({
  language = "pt-BR",
  visitorName,
  exhibitorCompany = "—",
  tableNumber = "—",
  slotStart,
  slotEnd,
  exploreUrl = "https://rodada.promperu.tur.br/explore",
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
            <Button href={exploreUrl} style={button}>
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
  component: MeetingCancelledEmail,
  subject: (d: Record<string, any>) => {
    const lang = d?.language === "es" ? "es" : "pt-BR";
    const c = d?.exhibitorCompany ?? "";
    return lang === "es"
      ? `Reunión cancelada — ${c}`
      : `Reunião cancelada — ${c}`;
  },
  displayName: "Meeting cancelled",
  previewData: {
    language: "pt-BR",
    visitorName: "Maria",
    exhibitorCompany: "Andean Tours SAC",
    tableNumber: 12,
    slotStart: "2026-07-08T13:00:00Z",
    slotEnd: "2026-07-08T13:15:00Z",
    exploreUrl: "https://rodada.promperu.tur.br/explore",
  },
} satisfies TemplateEntry;