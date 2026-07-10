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
  container,
  footer,
  h1,
  main,
  text,
} from "./_shared";
import { TEMPLATE_COPY_DEFAULTS, interpolate } from "./copy-defaults";

interface Props {
  visitorName?: string;
  eventName?: string;
  bodyText?: string;
  buttonLabel?: string;
  buttonUrl?: string;
}

/**
 * Split a plain-text body into safe paragraphs. The body arrives from the
 * admin campaign editor as free text; splitting by blank line and rendering
 * each block as its own <Text> keeps whitespace legible without introducing
 * markdown parsing or dangerouslySetInnerHTML. React escapes each string.
 */
function paragraphs(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const AgendaDeliveryEmail = ({
  visitorName,
  eventName = "",
  bodyText = "",
  buttonLabel = "Baixar minha agenda",
  buttonUrl = "#",
}: Props) => {
  const defaults = TEMPLATE_COPY_DEFAULTS["agenda-delivery"].copy["pt-BR"];
  const interpData = {
    visitorName: visitorName ?? "",
    eventName,
    buttonLabel,
  };
  const greeting = interpolate(defaults.greeting, interpData);
  const signature = interpolate(defaults.signature, interpData);
  const paras = paragraphs(bodyText || defaults.intro);
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{`Sua agenda — ${eventName}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Sua agenda</Heading>
          <Text style={text}>{greeting}</Text>
          {paras.map((p, i) => (
            <Text key={i} style={text}>
              {p}
            </Text>
          ))}
          <Section style={{ textAlign: "center", margin: "16px 0 24px" }}>
            <Button href={buttonUrl} style={button}>
              {buttonLabel}
            </Button>
          </Section>
          <Text style={footer}>{signature}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: AgendaDeliveryEmail,
  subject: (d: Record<string, any>) => {
    // Campaign always provides an explicit subject through overrideSubject.
    const subjectTpl =
      d?.overrideSubject ?? TEMPLATE_COPY_DEFAULTS["agenda-delivery"].subject["pt-BR"];
    return interpolate(subjectTpl, d ?? {});
  },
  displayName: "Entrega de agenda (campanha admin)",
  previewData: {
    visitorName: "Maria",
    eventName: "Networking Event",
    bodyText:
      "Sua agenda pessoal está pronta.\n\nClique no botão abaixo para baixar o PDF com todos os seus horários confirmados.",
    buttonLabel: "Baixar minha agenda",
    buttonUrl: "https://example.com/api/public/agenda-download/xxx/yyy",
  },
} satisfies TemplateEntry;