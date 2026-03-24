import { summarizeLead } from "./lead-state.js";

export function buildContext({ leadState, session, messages, retrievedKnowledge, nextMissingField }) {
  const lastMessages = messages.slice(-8).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  return {
    prompt_version: "v1.0.0-mvp-orchestrator",
    session: {
      id: session.id,
      stage: session.stage,
      updated_at: session.updated_at,
    },
    lead_summary: summarizeLead(leadState),
    lead_state: {
      nome: leadState.nome,
      telefone: leadState.telefone,
      email: leadState.email,
      cidade: leadState.cidade,
      fonte: leadState.fonte,
      intencao: leadState.intencao,
      produto_interesse: leadState.produto_interesse,
      metodo_negociacao: leadState.metodo_negociacao,
      orcamento: leadState.orcamento,
      prazo: leadState.prazo,
      forma_pagamento: leadState.forma_pagamento,
      possui_troca: leadState.possui_troca,
      sentimento: leadState.sentimento,
      estagio: leadState.estagio,
      score: leadState.score,
      classificacao: leadState.classificacao,
      proximo_passo: leadState.proximo_passo,
      escalonado: leadState.escalonado,
      tipo_handoff: leadState.tipo_handoff,
      detalhes_troca_solicitados: leadState.detalhes_troca_solicitados,
      duvidas_pendentes: leadState.duvidas_pendentes || [],
    },
    next_missing_field: nextMissingField,
    retrieved_knowledge: retrievedKnowledge,
    recent_messages: lastMessages,
  };
}
