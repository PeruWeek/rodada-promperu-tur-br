import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, button, footer } from './_shared'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu link de acesso · Tu enlace de acceso — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Seu link de acesso</Heading>
        <Text style={text}>
          Clique no botão abaixo para entrar em {siteName}. Este link expira em pouco tempo.
        </Text>
        <Button style={button} href={confirmationUrl}>Entrar</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Se você não solicitou este link, pode ignorar este e-mail.
        </Text>

        <Hr style={{ borderColor: '#eeeeee', margin: '32px 0' }} />

        <Heading style={h1}>Tu enlace de acceso</Heading>
        <Text style={text}>
          Haz clic en el botón para ingresar a {siteName}. Este enlace expira en poco tiempo.
        </Text>
        <Button style={button} href={confirmationUrl}>Ingresar</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Si no solicitaste este enlace, puedes ignorar este correo.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
