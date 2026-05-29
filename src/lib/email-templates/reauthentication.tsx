import * as React from 'react'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, footer } from './_shared'

interface ReauthenticationEmailProps {
  token: string
}

const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  fontWeight: '700' as const,
  color: '#111111',
  letterSpacing: '4px',
  margin: '0 0 16px',
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu código de verificação · Tu código de verificación</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Código de verificação</Heading>
        <Text style={text}>Use o código abaixo para confirmar sua identidade:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={{ ...text, marginTop: '8px' }}>
          Este código expira em pouco tempo. Se você não solicitou, ignore este e-mail.
        </Text>

        <Hr style={{ borderColor: '#eeeeee', margin: '32px 0' }} />

        <Heading style={h1}>Código de verificación</Heading>
        <Text style={text}>Usa el siguiente código para confirmar tu identidad:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={{ ...text, marginTop: '8px' }}>
          Este código expira en poco tiempo. Si no lo solicitaste, ignora este correo.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
