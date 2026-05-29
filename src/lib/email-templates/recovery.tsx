import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, button, footer } from './_shared'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Redefinir senha · Restablecer contraseña — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Redefinir senha</Heading>
        <Text style={text}>
          Recebemos um pedido para redefinir sua senha em {siteName}. Clique no botão abaixo para escolher uma nova senha.
        </Text>
        <Button style={button} href={confirmationUrl}>Redefinir senha</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Se você não pediu a redefinição, pode ignorar este e-mail. Sua senha permanecerá a mesma.
        </Text>

        <Hr style={{ borderColor: '#eeeeee', margin: '32px 0' }} />

        <Heading style={h1}>Restablecer contraseña</Heading>
        <Text style={text}>
          Recibimos una solicitud para restablecer tu contraseña en {siteName}. Haz clic en el botón para elegir una nueva contraseña.
        </Text>
        <Button style={button} href={confirmationUrl}>Restablecer contraseña</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Si no solicitaste el restablecimiento, puedes ignorar este correo. Tu contraseña no cambiará.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
