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

interface Props {
  language?: EmailLang;
  visitorName?: string;
  qaUrl?: string;
  eventName?: string;
  overrides?: Partial<CopyFields>;
}

function withoutOldOptionalCopy(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  return /não informar agora|nao informar agora|no informar ahora/i.test(value)
    ? fallback
    : value;
}

const PostEventQAEmail = ({
  language = "pt-BR",
  visitorName,
  qaUrl = "https://rodada.promperu.tur.br",
  eventName = "Rodada de Negócios PromPerú",
  overrides,
}: Props) => {
  const lang = language === "es" ? "es" : "pt-BR";
  const defaults = TEMPLATE_COPY_DEFAULTS["postevent-qa"].copy[lang];
  const interpData = { visitorName: visitorName ?? "", eventName };
  const greeting = interpolate(
    withoutOldOptionalCopy(overrides?.greeting, defaults.greeting),
    interpData,
  );
  const intro = interpolate(withoutOldOptionalCopy(overrides?.intro, defaults.intro), interpData);
  const outro = interpolate(withoutOldOptionalCopy(overrides?.outro, defaults.outro), interpData);
  const ctaLabel = interpolate(
    withoutOldOptionalCopy(overrides?.ctaLabel, defaults.ctaLabel),
    interpData,
  );
  const signature = interpolate(
    withoutOldOptionalCopy(overrides?.signature, defaults.signature),
    interpData,
  );
  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>
        {lang === "es"
          ? "Confirma con qué empresas te reuniste"
          : "Confirme com quais empresas você se reuniu"}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {lang === "es" ? "Gracias por participar" : "Obrigado por participar"}
          </Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>{intro}</Text>
          <Section style={{ textAlign: "center", margin: "16px 0 24px" }}>
            <Button href={qaUrl} style={button}>
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
  component: PostEventQAEmail,
  subject: (d: Record<string, any>) => {
    const lang = d?.language === "es" ? "es" : "pt-BR";
    const subjectTpl =
      d?.overrideSubject ?? TEMPLATE_COPY_DEFAULTS["postevent-qa"].subject[lang];
    return interpolate(subjectTpl, d ?? {});
  },
  displayName: "Post-event Q&A",
  previewData: {
    language: "pt-BR",
    visitorName: "Maria",
    qaUrl: "https://rodada.promperu.tur.br/qa/example-token",
    eventName: "Rodada de Negócios PromPerú",
  },
} satisfies TemplateEntry;