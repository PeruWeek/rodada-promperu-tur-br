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
import {
  TEMPLATE_COPY_DEFAULTS,
  interpolate,
  type CopyFields,
  type EmailLang,
} from "./copy-defaults";

const LABELS = {
  "pt-BR": { h1: "Reunião confirmada", company: "Expositor", table: "Mesa", when: "Horário", previewPrefix: "Sua reunião com" },
  es: { h1: "Reunión confirmada", company: "Expositor", table: "Mesa", when: "Horario", previewPrefix: "Tu reunión con" },
} as const;

interface Props {
  language?: EmailLang;
  visitorName?: string;
  exhibitorCompany?: string;
  tableNumber?: number | string;
  slotStart?: string;
  slotEnd?: string;
  agendaUrl?: string;
  overrides?: Partial<CopyFields>;
}

const MeetingConfirmationEmail = ({
  language = "pt-BR",
  visitorName,
  exhibitorCompany = "—",
  tableNumber = "—",
  slotStart,
  slotEnd,
  agendaUrl = "#",
  overrides,
}: Props) => {
  const lang = language === "es" ? "es" : "pt-BR";
  const labels = LABELS[lang];
  const defaults = TEMPLATE_COPY_DEFAULTS["meeting-confirmation"].copy[lang];
  const interpData = { visitorName: visitorName ?? "", exhibitorCompany, tableNumber, slotStart: slotStart ?? "", slotEnd: slotEnd ?? "" };
  const greeting = interpolate(overrides?.greeting ?? defaults.greeting, interpData);
  const intro = interpolate(overrides?.intro ?? defaults.intro, interpData);
  const outro = interpolate(overrides?.outro ?? defaults.outro, interpData);
  const ctaLabel = interpolate(overrides?.ctaLabel ?? defaults.ctaLabel, interpData);
  const signature = interpolate(overrides?.signature ?? defaults.signature, interpData);
  const when =
    slotStart && slotEnd ? formatSlot(slotStart, slotEnd, lang) : "—";
  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{`${labels.previewPrefix} ${exhibitorCompany}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{labels.h1}</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>{intro}</Text>
          <Section style={card}>
            <Text style={small}>
              <strong>{labels.company}:</strong> {exhibitorCompany}
            </Text>
            <Text style={small}>
              <strong>{labels.table}:</strong> {tableNumber}
            </Text>
            <Text style={small}>
              <strong>{labels.when}:</strong> {when}
            </Text>
          </Section>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href={agendaUrl} style={button}>
              {ctaLabel}
            </Button>
          </Section>
          <Text style={small}>{outro}</Text>
          <Text style={footer}>{signature}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: MeetingConfirmationEmail,
  subject: (d: Record<string, any>) => {
    const lang = d?.language === "es" ? "es" : "pt-BR";
    const subjectTpl =
      d?.overrideSubject ??
      TEMPLATE_COPY_DEFAULTS["meeting-confirmation"].subject[lang];
    return interpolate(subjectTpl, d ?? {});
  },
  displayName: "Meeting confirmation",
  previewData: {
    language: "pt-BR",
    visitorName: "Maria",
    exhibitorCompany: "Andean Tours SAC",
    tableNumber: 12,
    slotStart: "2026-07-08T13:00:00Z",
    slotEnd: "2026-07-08T13:15:00Z",
    agendaUrl: "https://example.com/agenda",
  },
} satisfies TemplateEntry;