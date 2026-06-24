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

interface Props {
  visitorName?: string;
  agendaUrl?: string;
}

const BuyerWelcomeEmail = ({
  visitorName,
  agendaUrl = "https://rodada.promperu.tur.br/agenda",
}: Props) => {
  const greeting = visitorName ? `Olá, ${visitorName}!` : "Olá!";
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>Seu cadastro no PERU MICE Networking evento foi concluído</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Cadastro confirmado</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Seu cadastro no PERU MICE Networking evento foi concluído com sucesso.
          </Text>
          <Text style={text}>
            Sua agenda já está disponível na plataforma. Acesse pelo link abaixo:
          </Text>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href={agendaUrl} style={button}>
              Acessar minha agenda
            </Button>
          </Section>
          <Text style={text}>Na plataforma, você poderá:</Text>
          <Text style={small}>• consultar sua agenda de reuniões</Text>
          <Text style={small}>• acompanhar atualizações do evento</Text>
          <Text style={small}>• revisar seus dados cadastrais</Text>
          <Text style={small}>• visualizar suas próximas interações</Text>
          <Text style={small}>• baixar sua agenda em PDF</Text>
          <Text style={text}>
            Recomendamos acessar a plataforma regularmente para acompanhar
            novidades e garantir que todas as suas informações estejam corretas.
          </Text>
          <Text style={text}>
            Caso não se recorde da sua senha, utilize o botão abaixo para redefinir seu acesso:
          </Text>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href="https://rodada.promperu.tur.br/forgot-password" style={button}>
              Recuperar minha senha
            </Button>
          </Section>
          <Text style={small}>
            Em caso de dúvidas, entre em contato com a organização.
          </Text>
          <Text style={small}>WhatsApp (11) 99367-0633</Text>
          <Text style={footer}>Atenciosamente,<br />Equipe PERU MICE Networking evento</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: BuyerWelcomeEmail,
  subject: "Cadastro confirmado | PERU MICE Networking evento",
  displayName: "Buyer welcome",
  previewData: {
    visitorName: "Maria",
    agendaUrl: "https://rodada.promperu.tur.br/agenda",
  },
} satisfies TemplateEntry;