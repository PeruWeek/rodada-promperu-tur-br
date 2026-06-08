export const EXPECTED_MEETINGS_MIN = 6;

export const REGISTRATION_STATUSES = [
  "nao_iniciado",
  "em_preenchimento",
  "cadastro_concluido",
  "aguardando_aprovacao",
  "aprovado",
  "bloqueado",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const SCHEDULING_STATUSES = [
  "sem_agendamento",
  "agendamento_iniciado",
  "agendado_parcial",
  "agendado_ok",
  "agenda_fechada",
] as const;
export type SchedulingStatus = (typeof SCHEDULING_STATUSES)[number];

export const NEXT_ACTIONS = [
  "nenhuma",
  "ligar_para_confirmar",
  "cobrar_documentos",
  "aguardar_retorno",
  "aprovar_cadastro",
  "ajustar_perfil",
  "estimular_agendamento",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const PRIORITIES = ["baixa", "media", "alta"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const COMPANY_TYPES = [
  "agencia",
  "operadora",
  "corporativo",
  "organizadora",
  "associacao",
  "hotel",
  "dmc",
  "centro_de_convencoes",
  "transporte",
  "tecnologia_eventos",
  "outro",
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_CATEGORIES = [
  "buyer_prioritario",
  "buyer_secundario",
  "fornecedor_mice",
  "hotelaria",
  "destino",
  "parceiro_institucional",
  "imprensa",
  "outro",
] as const;
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export const COMPANY_ROLES = ["exhibitor", "visitor"] as const;
export type PipelineCompanyRole = (typeof COMPANY_ROLES)[number];