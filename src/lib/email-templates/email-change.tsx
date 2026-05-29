import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, button, footer } from './_shared'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ siteName, oldEmail, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Confirme seu novo e-mail · Confirma tu nuevo correo — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirme seu novo e-mail</Heading>
        <Text style={text}>
          Você solicitou alterar o e-mail da sua conta em {siteName} de <strong>{oldEmail}</strong> para <strong>{newEmail}</strong>.
        </Text>
        <Button style={button} href={confirmationUrl}>Confirmar alteração</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Se você não solicitou esta alteração, proteja sua conta imediatamente.
        </Text>

        <Hr style={{ borderColor: '#eeeeee', margin: '32px 0' }} />

        <Heading style={h1}>Confirma tu nuevo correo</Heading>
        <Text style={text}>
          Solicitaste cambiar el correo de tu cuenta en {siteName} de <strong>{oldEmail}</strong> a <strong>{newEmail}</strong>.
        </Text>
        <Button style={button} href={confirmationUrl}>Confirmar cambio</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Si no solicitaste este cambio, asegura tu cuenta inmediatamente.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
