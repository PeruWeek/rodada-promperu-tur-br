export type TaxonomyKey = "segments" | "services" | "destinations" | "buyer_types";

export const TAXONOMY: Record<TaxonomyKey, { value: string; pt: string; es: string }[]> = {
  segments: [
    { value: "mice", pt: "MICE", es: "MICE" },
    { value: "incentive", pt: "Incentivo", es: "Incentivos" },
    { value: "luxury", pt: "Luxo", es: "Lujo" },
    { value: "adventure", pt: "Aventura", es: "Aventura" },
    { value: "culture", pt: "Cultural", es: "Cultural" },
    { value: "gastronomy", pt: "Gastronomia", es: "Gastronomía" },
    { value: "wellness", pt: "Bem-estar", es: "Bienestar" },
    { value: "leisure", pt: "Lazer", es: "Ocio" },
    { value: "weddings", pt: "Casamentos", es: "Bodas" },
    { value: "sports_events", pt: "Eventos esportivos", es: "Eventos deportivos" },
  ],
  services: [
    { value: "dmc", pt: "DMC", es: "DMC" },
    { value: "hotel", pt: "Hotel", es: "Hotel" },
    { value: "transport", pt: "Transporte", es: "Transporte" },
    { value: "venue", pt: "Local de eventos", es: "Sede de eventos" },
    { value: "tour_operator", pt: "Operadora", es: "Operador" },
    { value: "travel_agency", pt: "Agência de viagens", es: "Agencia de viajes" },
    { value: "convention_bureau", pt: "Convention Bureau", es: "Convention Bureau" },
    { value: "guide", pt: "Guia", es: "Guía" },
    { value: "catering", pt: "Catering", es: "Catering" },
    { value: "production", pt: "Produtora de eventos", es: "Productora de eventos" },
  ],
  destinations: [
    { value: "lima", pt: "Lima", es: "Lima" },
    { value: "cusco", pt: "Cusco", es: "Cusco" },
    { value: "arequipa", pt: "Arequipa", es: "Arequipa" },
    { value: "puno_titicaca", pt: "Puno / Titicaca", es: "Puno / Titicaca" },
    { value: "amazon", pt: "Amazônia", es: "Amazonía" },
    { value: "nazca_paracas", pt: "Nazca / Paracas", es: "Nazca / Paracas" },
    { value: "trujillo", pt: "Trujillo", es: "Trujillo" },
    { value: "north_beaches", pt: "Praias do Norte", es: "Playas del Norte" },
  ],
  buyer_types: [
    { value: "agency", pt: "Agência de viagens", es: "Agencia de viajes" },
    { value: "operator", pt: "Operadora", es: "Operador" },
    { value: "corporate", pt: "Corporativo", es: "Corporativo" },
    { value: "event_planner", pt: "Organizador de eventos", es: "Organizador de eventos" },
    { value: "association", pt: "Agência de incentivos", es: "Agencia de incentivos" },
    { value: "other", pt: "Outro", es: "Otro" },
  ],
};

export function taxonomyLabel(key: TaxonomyKey, value: string, lang: "pt-BR" | "es"): string {
  const item = TAXONOMY[key].find((i) => i.value === value);
  if (!item) return value;
  return lang === "es" ? item.es : item.pt;
}

export const COUNTRIES: { value: string; pt: string; es: string }[] = [
  { value: "BR", pt: "Brasil", es: "Brasil" },
  { value: "PE", pt: "Peru", es: "Perú" },
  { value: "AR", pt: "Argentina", es: "Argentina" },
  { value: "CL", pt: "Chile", es: "Chile" },
  { value: "CO", pt: "Colômbia", es: "Colombia" },
  { value: "MX", pt: "México", es: "México" },
  { value: "UY", pt: "Uruguai", es: "Uruguay" },
  { value: "PY", pt: "Paraguai", es: "Paraguay" },
  { value: "EC", pt: "Equador", es: "Ecuador" },
  { value: "BO", pt: "Bolívia", es: "Bolivia" },
  { value: "US", pt: "Estados Unidos", es: "Estados Unidos" },
  { value: "ES", pt: "Espanha", es: "España" },
  { value: "OTHER", pt: "Outro", es: "Otro" },
];
