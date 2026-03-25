import { STAGES } from "./constants.js";

export function createEmptyLeadState(sessionId, leadId) {
  const now = new Date().toISOString();

  return {
    session_id: sessionId,
    lead_id: leadId,
    nome: "",
    telefone: "",
    cpf: "",
    email: "",
    renda_mensal: "",
    cidade: "",
    fonte: "",
    intencao: "",
    produto_interesse: "",
    metodo_negociacao: "",
    orcamento: "",
    prazo: "",
    forma_pagamento: "",
    possui_troca: "",
    troca_modelo: "",
    troca_ano: "",
    troca_km: "",
    troca_quitado: "",
    sentimento: "neutro",
    estagio: STAGES.ABERTURA,
    score: 0,
    classificacao: "nao_pronto",
    proximo_passo: "identificar_veiculo_e_metodo",
    escalonado: false,
    tipo_handoff: "",
    handoff_motivo: "",
    handoff_prioritario: false,
    detalhes_troca_solicitados: false,
    veiculo_contexto: null,
    duvidas_pendentes: [],
    resumo_conversa: "",
    consentimento: false,
    created_at: now,
    updated_at: now,
    dados_confirmados: {},
    dados_inferidos: {},
  };
}

export function mergeLeadState(previous, updates = {}, source = "confirmed") {
  const next = {
    ...previous,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const targetKey = source === "inferred" ? "dados_inferidos" : "dados_confirmados";
  const target = { ...(next[targetKey] || {}) };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === "") continue;
    target[key] = {
      value,
      confidence: source === "inferred" ? 0.6 : 1,
      updated_at: next.updated_at,
    };
  }

  next[targetKey] = target;
  return next;
}

export function summarizeLead(leadState) {
  const parts = [];

  if (leadState.nome) parts.push(`Nome: ${leadState.nome}`);
  if (leadState.intencao) parts.push(`Intencao: ${leadState.intencao}`);
  if (leadState.produto_interesse) parts.push(`Produto: ${leadState.produto_interesse}`);
  if (leadState.metodo_negociacao) parts.push(`Metodo: ${leadState.metodo_negociacao}`);
  if (leadState.renda_mensal) parts.push(`Renda: ${leadState.renda_mensal}`);
  if (leadState.troca_modelo) parts.push(`Troca modelo: ${leadState.troca_modelo}`);
  if (leadState.troca_ano) parts.push(`Troca ano: ${leadState.troca_ano}`);
  if (leadState.troca_km) parts.push(`Troca km: ${leadState.troca_km}`);
  if (leadState.troca_quitado) parts.push(`Troca quitado: ${leadState.troca_quitado}`);
  if (leadState.sentimento) parts.push(`Sentimento: ${leadState.sentimento}`);
  if (leadState.classificacao) parts.push(`Classificacao: ${leadState.classificacao}`);
  if (leadState.escalonado) parts.push(`Escalonado: sim`);

  return parts.join(" | ");
}
