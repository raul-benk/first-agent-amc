import { STAGES } from "./constants.js";
import { listEvents, listLeads, listSessions, listToolCalls } from "./store.js";

function safeAvg(numbers) {
  if (!numbers.length) return 0;
  const sum = numbers.reduce((acc, value) => acc + value, 0);
  return sum / numbers.length;
}

export async function computeOperationalMetrics() {
  const [events, leads, sessions, toolCalls] = await Promise.all([
    listEvents(10000),
    listLeads(),
    listSessions(),
    listToolCalls(10000),
  ]);

  const qualifiedLeads = leads.filter((lead) =>
    ["quente", "pronto_para_escalonamento"].includes(String(lead.classificacao || "")),
  );
  const collectedDataLeads = leads.filter((lead) => {
    return lead.nome && (lead.telefone || lead.email) && lead.intencao && lead.produto_interesse;
  });
  const convertedLeads = leads.filter(
    (lead) =>
      ["encaminhar_vendedor", "handoff_executado", "confirmar_encaminhamento"].includes(
        String(lead.proximo_passo || ""),
      ) ||
      lead.estagio === STAGES.ENCAMINHAMENTO ||
      lead.escalonado === true,
  );

  const turnFinished = events.filter((event) => event.event_type === "turn_finished");
  const latencies = turnFinished
    .map((event) => Number(event.payload?.latency_ms))
    .filter((value) => Number.isFinite(value) && value > 0);

  const tokenCosts = events
    .filter((event) => event.event_type === "llm_usage")
    .map((event) => Number(event.payload?.estimated_cost_usd))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const errors = [
    ...events.filter((event) => event.event_type.includes("error")),
    ...toolCalls.filter((call) => call.status === "error"),
  ];

  return {
    generated_at: new Date().toISOString(),
    totals: {
      sessions: sessions.length,
      leads: leads.length,
      tool_calls: toolCalls.length,
      errors: errors.length,
    },
    rates: {
      qualificacao: leads.length ? qualifiedLeads.length / leads.length : 0,
      coleta_dados: leads.length ? collectedDataLeads.length / leads.length : 0,
      conversao: leads.length ? convertedLeads.length / leads.length : 0,
    },
    latency_ms: {
      avg: safeAvg(latencies),
      p95: percentile(latencies, 0.95),
    },
    cost: {
      total_usd: tokenCosts.reduce((acc, value) => acc + value, 0),
      avg_per_conversation_usd: sessions.length
        ? tokenCosts.reduce((acc, value) => acc + value, 0) / sessions.length
        : 0,
    },
  };
}

function percentile(numbers, p) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[idx];
}
