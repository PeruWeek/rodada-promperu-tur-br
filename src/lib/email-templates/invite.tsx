import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, button, footer, PRIMARY } from './_shared'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Você foi convidado · Has sido invitado — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Você foi convidado</Heading>
        <Text style={text}>
          Você foi convidado para participar de{' '}
          <Link href={siteUrl} style={{ color: PRIMARY }}><strong>{siteName}</strong></Link>. Clique no botão abaixo para aceitar o convite e criar sua conta.
        </Text>
        <Button style={button} href={confirmationUrl}>Aceitar convite</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Se você não esperava este convite, pode ignorar este e-mail.
        </Text>

        <Hr style={{ borderColor: '#eeeeee', margin: '32px 0' }} />

        <Heading style={h1}>Has sido invitado</Heading>
        <Text style={text}>
          Has sido invitado a participar de{' '}
          <Link href={siteUrl} style={{ color: PRIMARY }}><strong>{siteName}</strong></Link>. Haz clic en el botón para aceptar la invitación y crear tu cuenta.
        </Text>
        <Button style={button} href={confirmationUrl}>Aceptar invitación</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Si no esperabas esta invitación, puedes ignorar este correo.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
