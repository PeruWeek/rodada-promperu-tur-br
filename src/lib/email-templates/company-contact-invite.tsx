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
  contactName?: string;
  companyName?: string;
  signupUrl?: string;
}

const CompanyContactInviteEmail = ({
  contactName,
  companyName,
  signupUrl = "#",
}: Props) => {
  const greeting = contactName ? `Olá, ${contactName}!` : "Olá!";
  const company = companyName ? ` da empresa ${companyName}` : "";
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>Você foi convidado para acessar o PERU MICE Networking</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Você foi convidado</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Você foi cadastrado como contato{company} no PERU MICE Networking.
          </Text>
          <Text style={text}>
            Para concluir seu acesso, faça seu cadastro usando este mesmo e-mail.
            Sua conta será vinculada automaticamente à empresa.
          </Text>
          <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
            <Button href={signupUrl} style={button}>
              Concluir meu cadastro
            </Button>
          </Section>
          <Text style={small}>
            Caso já possua acesso, utilize a opção "Recuperar senha" na tela de login.
          </Text>
          <Text style={footer}>
            Atenciosamente,<br />Equipe PERU MICE Networking evento
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: CompanyContactInviteEmail,
  subject: "Convite para acessar o PERU MICE Networking",
  displayName: "Company contact invite",
  previewData: {
    contactName: "Maria",
    companyName: "ACME Turismo",
    signupUrl: "https://example.com/signup",
  },
} satisfies TemplateEntry;