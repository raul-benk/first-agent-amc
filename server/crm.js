import { addCrmSync } from "./store.js";

const CRM_ENDPOINT = process.env.CRM_WEBHOOK_URL || "";
const CRM_API_KEY = process.env.CRM_API_KEY || "";

async function postToCRM(payload) {
  if (!CRM_ENDPOINT) {
    return {
      synced: false,
      mode: "noop",
      reason: "CRM_WEBHOOK_URL nao configurada",
    };
  }

  const response = await fetch(CRM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CRM_API_KEY ? { Authorization: `Bearer ${CRM_API_KEY}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha no CRM (${response.status}): ${text}`);
  }

  return {
    synced: true,
    mode: "webhook",
    status: response.status,
    response: text.slice(0, 400),
  };
}

export async function syncLeadToCRM(sessionId, leadState) {
  const payload = {
    session_id: sessionId,
    lead_id: leadState.lead_id,
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
    score: leadState.score,
    classificacao: leadState.classificacao,
    proximo_passo: leadState.proximo_passo,
    duvidas_pendentes: leadState.duvidas_pendentes || [],
    consentimento: leadState.consentimento,
    updated_at: leadState.updated_at,
  };

  const startedAt = Date.now();
  try {
    const result = await postToCRM(payload);
    const sync = await addCrmSync({
      session_id: sessionId,
      lead_id: leadState.lead_id,
      payload,
      result,
      status: "success",
      latency_ms: Date.now() - startedAt,
    });
    return {
      ...result,
      sync_id: sync.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido no CRM.";
    await addCrmSync({
      session_id: sessionId,
      lead_id: leadState.lead_id,
      payload,
      result: null,
      status: "error",
      error_message: message,
      latency_ms: Date.now() - startedAt,
    });
    throw error;
  }
}
