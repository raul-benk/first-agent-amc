import { randomUUID } from "node:crypto";
import { runConversationTurn } from "./orchestrator.js";
import { appendMessage, addEvalResult } from "./store.js";

const DEFAULT_SCENARIOS = [
  {
    id: "coleta_completa",
    turns: [
      "Ola, quero comprar um carro.",
      "Meu nome e Ana Souza.",
      "Meu telefone e 11987654321 e meu email e ana@email.com.",
      "Moro em Campinas, meu orcamento e R$ 90.000 e quero comprar este mes.",
      "Autorizo o uso dos meus dados.",
    ],
    assertions: {
      min_score: 60,
      expected_stage: "07_encaminhamento",
    },
  },
  {
    id: "dados_incompletos",
    turns: ["Quero agendar visita.", "Ainda nao quero passar meus dados."],
    assertions: {
      max_score: 45,
      expected_next_step: "solicitar_consentimento_lgpd",
    },
  },
  {
    id: "duvida_fora_escopo",
    turns: ["Vocês vendem motos aquaticas?"],
    assertions: {
      expect_response: "pre-atendimento",
    },
  },
];

export async function runEvalSuite({ apiKey, model = "gpt-5-mini", temperature = 0.3, scenarios }) {
  const selectedScenarios = Array.isArray(scenarios) && scenarios.length ? scenarios : DEFAULT_SCENARIOS;
  const results = [];

  for (const scenario of selectedScenarios) {
    const sessionId = `eval_${scenario.id}_${randomUUID()}`;
    let lastResult = null;

    for (const userMessage of scenario.turns) {
      await appendMessage(sessionId, "user", userMessage, { eval_scenario: scenario.id });
      lastResult = await runConversationTurn({
        sessionId,
        userMessage,
        apiKey,
        model,
        temperature,
      });
      await appendMessage(sessionId, "assistant", lastResult.assistantMessage, {
        eval_scenario: scenario.id,
        score: lastResult.leadState.score,
      });
    }

    const evalResult = evaluateAssertions(scenario.assertions || {}, lastResult);
    const stored = await addEvalResult({
      scenario_id: scenario.id,
      session_id: sessionId,
      success: evalResult.success,
      details: evalResult.details,
      lead_state: lastResult?.leadState || null,
    });

    results.push({
      id: stored.id,
      scenario_id: scenario.id,
      success: evalResult.success,
      details: evalResult.details,
    });
  }

  return {
    total: results.length,
    success: results.filter((result) => result.success).length,
    failure: results.filter((result) => !result.success).length,
    results,
  };
}

function evaluateAssertions(assertions, result) {
  if (!result) {
    return {
      success: false,
      details: ["resultado ausente"],
    };
  }

  const details = [];
  let success = true;

  if (typeof assertions.min_score === "number" && result.leadState.score < assertions.min_score) {
    success = false;
    details.push(`score abaixo do minimo: ${result.leadState.score} < ${assertions.min_score}`);
  }

  if (typeof assertions.max_score === "number" && result.leadState.score > assertions.max_score) {
    success = false;
    details.push(`score acima do maximo: ${result.leadState.score} > ${assertions.max_score}`);
  }

  if (assertions.expected_stage && result.leadState.estagio !== assertions.expected_stage) {
    success = false;
    details.push(`estagio divergente: ${result.leadState.estagio} != ${assertions.expected_stage}`);
  }

  if (assertions.expected_next_step && result.leadState.proximo_passo !== assertions.expected_next_step) {
    success = false;
    details.push(
      `proximo passo divergente: ${result.leadState.proximo_passo} != ${assertions.expected_next_step}`,
    );
  }

  if (
    assertions.expect_response &&
    !result.assistantMessage.toLowerCase().includes(String(assertions.expect_response).toLowerCase())
  ) {
    success = false;
    details.push(`resposta nao contem termo esperado: ${assertions.expect_response}`);
  }

  if (!details.length) details.push("ok");
  return { success, details };
}
