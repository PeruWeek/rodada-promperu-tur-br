import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, button, footer, PRIMARY } from './_shared'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Confirme seu e-mail · Confirma tu correo — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirme seu e-mail</Heading>
        <Text style={text}>
          Obrigado por se cadastrar em{' '}
          <Link href={siteUrl} style={{ color: PRIMARY }}><strong>{siteName}</strong></Link>. Confirme seu endereço de e-mail ({recipient}) clicando no botão abaixo:
        </Text>
        <Button style={button} href={confirmationUrl}>Confirmar e-mail</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Se você não criou esta conta, pode ignorar este e-mail com segurança.
        </Text>

        <Hr style={{ borderColor: '#eeeeee', margin: '32px 0' }} />

        <Heading style={h1}>Confirma tu correo</Heading>
        <Text style={text}>
          Gracias por registrarte en{' '}
          <Link href={siteUrl} style={{ color: PRIMARY }}><strong>{siteName}</strong></Link>. Confirma tu dirección de correo ({recipient}) haciendo clic en el botón:
        </Text>
        <Button style={button} href={confirmationUrl}>Confirmar correo</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Si no creaste esta cuenta, puedes ignorar este correo con seguridad.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
