import { STAGES } from "./constants.js";

export function classifyLead(leadState) {
  const ready = isReadyForEscalation(leadState);
  const emotionalPriority = leadState.sentimento === "negativo";

  return {
    score: ready ? 100 : 35,
    classificacao: ready ? "pronto_para_escalonamento" : "nao_pronto",
    estagio: ready ? STAGES.ENCAMINHAMENTO : inferStage(leadState),
    proximo_passo: ready ? "confirmar_encaminhamento" : inferNextStep(leadState),
    elegivel: ready,
    pendencias_elegibilidade: ready ? [] : listPending(leadState),
    handoff_prioritario: emotionalPriority,
  };
}

export function nextMissingField(leadState) {
  if (!leadState.produto_interesse) return "produto_interesse";
  if (!leadState.metodo_negociacao) return "metodo_negociacao";
  if (leadState.consentimento !== true) return "consentimento";
  return null;
}

export function isReadyForEscalation(leadState) {
  return Boolean(leadState.produto_interesse && leadState.metodo_negociacao && leadState.consentimento === true);
}

export function shouldHandoff(leadState, userMessage, hasDirectTrigger = false) {
  const text = (userMessage || "").toLowerCase();
  if (leadState.sentimento === "negativo") return true;
  if (hasDirectTrigger) return true;
  if (text.includes("falar com vendedor") || text.includes("falar com humano")) return true;
  if (leadState.consentimento !== true) return false;
  return false;
}

function inferStage(leadState) {
  if (!leadState.intencao) return STAGES.INTENCAO;
  if (!leadState.produto_interesse || !leadState.metodo_negociacao) return STAGES.DESCOBERTA;
  return STAGES.QUALIFICACAO;
}

function inferNextStep(leadState) {
  if (!leadState.intencao) return "confirmar_intencao";
  if (!leadState.produto_interesse) return "identificar_veiculo_interesse";
  if (!leadState.metodo_negociacao) return "identificar_metodo_negociacao";
  if (leadState.consentimento !== true) return "solicitar_consentimento_lgpd";
  return "escalar_imediatamente";
}

function listPending(leadState) {
  const pending = [];
  if (!leadState.produto_interesse) pending.push("produto_interesse");
  if (!leadState.metodo_negociacao) pending.push("metodo_negociacao");
  if (!leadState.intencao) pending.push("intencao");
  if (leadState.consentimento !== true) pending.push("consentimento");
  return pending;
}
