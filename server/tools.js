import { TOOL_NAMES } from "./constants.js";
import { retrieveKnowledgeHybrid } from "./rag.js";
import { addEvent, addToolCall, saveLead, updateLead } from "./store.js";
import { syncLeadToCRM } from "./crm.js";

async function withToolLog(sessionId, leadId, toolName, input, executor) {
  const start = Date.now();

  try {
    const output = await executor();
    await addToolCall({
      session_id: sessionId,
      lead_id: leadId,
      tool_name: toolName,
      input,
      output,
      status: "success",
      latency_ms: Date.now() - start,
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro na tool.";
    await addToolCall({
      session_id: sessionId,
      lead_id: leadId,
      tool_name: toolName,
      input,
      output: null,
      status: "error",
      error_message: message,
      latency_ms: Date.now() - start,
    });
    throw error;
  }
}

export async function salvarLead(sessionId, leadState) {
  return withToolLog(sessionId, leadState.lead_id, TOOL_NAMES.SALVAR_LEAD, leadState, () => saveLead(leadState));
}

export async function atualizarLead(sessionId, leadId, patch) {
  return withToolLog(sessionId, leadId, TOOL_NAMES.ATUALIZAR_LEAD, patch, () => updateLead(leadId, patch));
}

export async function classificarLead(sessionId, leadId, classification) {
  return withToolLog(sessionId, leadId, TOOL_NAMES.CLASSIFICAR_LEAD, classification, () =>
    updateLead(leadId, classification),
  );
}

export async function consultarBaseConhecimento(sessionId, leadId, query, limit = 3, apiKey = "") {
  return withToolLog(
    sessionId,
    leadId,
    TOOL_NAMES.CONSULTAR_BASE_CONHECIMENTO,
    { query, limit },
    () => retrieveKnowledgeHybrid({ apiKey, query, limit }),
  );
}

export async function acionarHandoff(sessionId, leadId, reason) {
  return withToolLog(sessionId, leadId, TOOL_NAMES.ACIONAR_HANDOFF, { reason }, async () => {
    await addEvent({
      session_id: sessionId,
      lead_id: leadId,
      event_type: "handoff_requested",
      payload: { reason },
    });

    return {
      handoff: true,
      channel: "vendedor_humano",
      reason,
    };
  });
}

export async function registrarEvento(sessionId, leadId, eventType, payload = {}) {
  return withToolLog(sessionId, leadId, TOOL_NAMES.REGISTRAR_EVENTO, { eventType, payload }, () =>
    addEvent({
      session_id: sessionId,
      lead_id: leadId,
      event_type: eventType,
      payload,
    }),
  );
}

export async function consultarAgenda(sessionId, leadId, query = {}) {
  return withToolLog(sessionId, leadId, TOOL_NAMES.CONSULTAR_AGENDA, query, async () => ({
    status: "not_implemented",
    message: "Tool prevista para fase futura.",
  }));
}

export async function sincronizarCRM(sessionId, leadState) {
  return withToolLog(
    sessionId,
    leadState.lead_id,
    TOOL_NAMES.SINCRONIZAR_CRM,
    {
      lead_id: leadState.lead_id,
      score: leadState.score,
      classificacao: leadState.classificacao,
    },
    () => syncLeadToCRM(sessionId, leadState),
  );
}
