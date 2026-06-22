import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from '@react-email/components'
import { main, container, h1, text, button, footer, PRIMARY } from './_shared'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

const LOGIN_URL = 'https://rodada.promperu.tur.br/login'

const secondaryButton = {
  ...button,
  backgroundColor: '#ffffff',
  color: PRIMARY,
  border: `2px solid ${PRIMARY}`,
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Cadastro recebido — confirme seu e-mail e agende suas reuniões</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Cadastro recebido com sucesso!</Heading>
        <Text style={text}>
          Obrigado por se cadastrar em{' '}
          <Link href={siteUrl} style={{ color: PRIMARY }}><strong>{siteName}</strong></Link>. Para ativar sua conta, confirme seu endereço de e-mail ({recipient}) clicando no botão abaixo:
        </Text>
        <Button style={button} href={confirmationUrl}>Confirmar e-mail</Button>
        <Text style={{ ...text, marginTop: '16px' }}>
          Depois de confirmar, entre com o e-mail e a senha cadastrados para agendar suas reuniões na rodada de negocios.
        </Text>
        <Button style={secondaryButton} href={LOGIN_URL}>Entrar e ver minha agenda</Button>
        <Text style={{ ...text, marginTop: '16px', fontSize: '13px', color: '#666' }}>
          Se você não criou esta conta, pode ignorar este e-mail com segurança.
        </Text>

        <Text style={footer}>Rodada de Negócios MICE · Peru × Brasil — 08/07/2026</Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
