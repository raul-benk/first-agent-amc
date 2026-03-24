export const STAGES = {
  ABERTURA: "01_abertura",
  INTENCAO: "02_identificacao_intencao",
  DESCOBERTA: "03_descoberta",
  COLETA: "04_coleta_dados",
  QUALIFICACAO: "05_qualificacao",
  DUVIDAS: "06_resolucao_duvidas",
  ENCAMINHAMENTO: "07_encaminhamento",
  ENCERRAMENTO: "08_encerramento",
};

export const STAGE_ORDER = [
  STAGES.ABERTURA,
  STAGES.INTENCAO,
  STAGES.DESCOBERTA,
  STAGES.COLETA,
  STAGES.QUALIFICACAO,
  STAGES.DUVIDAS,
  STAGES.ENCAMINHAMENTO,
  STAGES.ENCERRAMENTO,
];

export const STAGE_REQUIRED_FIELDS = {
  [STAGES.INTENCAO]: ["intencao"],
  [STAGES.DESCOBERTA]: ["produto_interesse", "metodo_negociacao"],
  [STAGES.COLETA]: [],
  [STAGES.QUALIFICACAO]: [],
};

export const TOOL_NAMES = {
  SALVAR_LEAD: "salvar_lead",
  ATUALIZAR_LEAD: "atualizar_lead",
  CLASSIFICAR_LEAD: "classificar_lead",
  CONSULTAR_BASE_CONHECIMENTO: "consultar_base_conhecimento",
  ACIONAR_HANDOFF: "acionar_handoff",
  REGISTRAR_EVENTO: "registrar_evento",
  CONSULTAR_AGENDA: "consultar_agenda",
  SINCRONIZAR_CRM: "sincronizar_crm",
};

export const LEAD_SCORE_THRESHOLDS = {
  COLD_MAX: 44,
  WARM_MAX: 74,
  HOT_MIN: 75,
};
