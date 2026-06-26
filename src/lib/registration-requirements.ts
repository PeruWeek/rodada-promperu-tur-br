/**
 * Fonte única da verdade dos campos obrigatórios para considerar um cadastro
 * de visitante/comprador (e expositor) como CONCLUÍDO.
 *
 * Esta regra é consumida por:
 *   - frontend (`/signup`, `/onboarding`, `/profile`)
 *   - admin (`complete-registration-dialog`, `staff-registration.functions`)
 *   - hook `use-visitor-ready`
 *   - RPC `complete_buyer_signup` e trigger
 *     `enforce_visitor_signup_completion_fields` no banco (que reproduzem
 *     a mesma regra em SQL).
 *
 * Qualquer mudança aqui DEVE ser refletida na migration SQL que mantém a
 * defesa-em-profundidade (RPC + trigger). Nunca avaliar conclusão em outro
 * lugar do código sem reusar `computeMissing`.
 *
 * Regra final usada para distinguir "pendente" vs "completo":
 *   - completo  ⇔  `visitor_profiles.signup_completed_at IS NOT NULL`
 *                 (e, por construção do trigger, todos os campos
 *                  obrigatórios abaixo estão preenchidos)
 *   - pendente  ⇔  qualquer outro estado (inclui stubs importados,
 *                  perfis recém-criados, retries incompletos etc.)
 */

export const VISITOR_REQUIRED_FIELDS = {
  // Contato (idioma é OPCIONAL — não bloqueia conclusão)
  profile: ["full_name", "job_title", "whatsapp"] as const,
  // Empresa (CNPJ + cidade + UF obrigatórios para visitor BR)
  company: ["trade_name", "city", "state_code", "tax_id"] as const,
  // Operacionais / consentimentos
  visitor: [
    "networking_lunch_participation",
    "image_authorization",
    "consent_data_sharing",
  ] as const,
} as const;

export const EXHIBITOR_REQUIRED_FIELDS = {
  profile: ["full_name", "job_title", "whatsapp"] as const,
  company: ["trade_name", "city"] as const,
  exhibitor: ["segments", "services"] as const,
} as const;

export type RegistrationKind = "visitor" | "exhibitor";

/** Labels PT-BR exibidos no modal "Completar cadastro" e em mensagens. */
export const REGISTRATION_FIELD_LABEL: Record<string, string> = {
  "profile.full_name": "Nome do contato",
  "profile.job_title": "Cargo",
  "profile.whatsapp": "WhatsApp",
  "company.trade_name": "Nome fantasia",
  "company.tax_id": "CNPJ",
  "company.city": "Cidade",
  "company.state_code": "UF",
  "visitor.networking_lunch_participation": "Almoço networking",
  "visitor.image_authorization": "Autorização de imagem",
  "visitor.consent_data_sharing": "Consentimento de dados",
  "exhibitor.segments": "Segmentos",
  "exhibitor.services": "Serviços",
};

export function labelForRequirement(field: string): string {
  return REGISTRATION_FIELD_LABEL[field] ?? field;
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export type MissingInput = {
  kind: RegistrationKind;
  profile: Partial<Record<string, unknown>>;
  company: Partial<Record<string, unknown>>;
  visitor?: Partial<Record<string, unknown>> | null;
  exhibitor?: Partial<Record<string, unknown>> | null;
};

/** Calcula a lista de campos pendentes usando a regra central única. */
export function computeMissing(input: MissingInput): string[] {
  const out: string[] = [];
  if (input.kind === "visitor") {
    for (const f of VISITOR_REQUIRED_FIELDS.profile) {
      if (isBlank(input.profile?.[f])) out.push(`profile.${f}`);
    }
    for (const f of VISITOR_REQUIRED_FIELDS.company) {
      if (isBlank(input.company?.[f])) out.push(`company.${f}`);
    }
    const v = (input.visitor ?? {}) as Record<string, unknown>;
    if (typeof v.networking_lunch_participation !== "boolean")
      out.push("visitor.networking_lunch_participation");
    if (typeof v.image_authorization !== "boolean")
      out.push("visitor.image_authorization");
    if (v.consent_data_sharing !== true) out.push("visitor.consent_data_sharing");
  } else {
    for (const f of EXHIBITOR_REQUIRED_FIELDS.profile) {
      if (isBlank(input.profile?.[f])) out.push(`profile.${f}`);
    }
    for (const f of EXHIBITOR_REQUIRED_FIELDS.company) {
      if (isBlank(input.company?.[f])) out.push(`company.${f}`);
    }
    const e = (input.exhibitor ?? {}) as Record<string, unknown>;
    for (const f of EXHIBITOR_REQUIRED_FIELDS.exhibitor) {
      if (!Array.isArray(e[f]) || (e[f] as unknown[]).length === 0)
        out.push(`exhibitor.${f}`);
    }
  }
  return out;
}

export function isComplete(input: MissingInput): boolean {
  return computeMissing(input).length === 0;
}
