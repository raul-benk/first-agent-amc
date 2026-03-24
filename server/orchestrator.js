import { randomUUID } from "node:crypto";
import { classifyLead, nextMissingField, shouldHandoff } from "./business-rules.js";
import { buildContext } from "./context-builder.js";
import {
  detectSentimentTags,
  extractLeadUpdatesFromMessage,
  hasDirectEscalationTrigger,
  hasPriceOrSpecificConditionQuestion,
  hasTradeDetails,
  isQuestion,
} from "./extractors.js";
import { createEmptyLeadState, mergeLeadState, summarizeLead } from "./lead-state.js";
import { generateAssistantMessage } from "./llm.js";
import { buildSystemPrompt } from "./prompting.js";
import { getLead, getSession, listMessages, upsertSession } from "./store.js";
import {
  acionarHandoff,
  atualizarLead,
  classificarLead,
  consultarBaseConhecimento,
  registrarEvento,
  salvarLead,
  sincronizarCRM,
} from "./tools.js";

const ESCALATED_CONFIRMATION =
  "Seu atendimento já foi encaminhado para o vendedor que irá seguir com você.";
const ESCALATED_EMPATHETIC =
  "Entendi seu ponto e já encaminhei seu atendimento para um especialista da AMC Veículos seguir com prioridade por aqui.";
const DEFAULT_HANDOFF_MESSAGE =
  "Perfeito, já entendi seu interesse e a forma de negociação. Vou te encaminhar agora para um especialista da AMC Veículos seguir com você.";

export async function runConversationTurn({
  sessionId,
  userMessage,
  apiKey,
  model = "gpt-5-mini",
  temperature = 0.7,
  customPrompt = "",
  preloadedLead = null,
}) {
  const session = await upsertSession(sessionId);
  const existingLead = await getLead(session.lead_id);
  let leadState = existingLead || createEmptyLeadState(session.id, session.lead_id || randomUUID());
  const userAskedQuestion = isQuestion(userMessage);
  const isPriceQuestion = hasPriceOrSpecificConditionQuestion(userMessage);

  if (leadState.escalonado) {
    if (isPriceQuestion) {
      const response = buildPricePolicyMessage(leadState);
      return {
        sessionId: session.id,
        assistantMessage: response,
        leadState,
        context: {
          prompt_version: "v2.1.0-amc",
        },
      };
    }

    if (userAskedQuestion) {
      const retrievedKnowledge = await consultarBaseConhecimento(
        session.id,
        leadState.lead_id,
        userMessage,
        5,
        apiKey,
      );
      const messages = await listMessages(session.id, 20);
      const context = buildContext({
        leadState,
        session: (await getSession(session.id)) || session,
        messages,
        retrievedKnowledge,
        nextMissingField: null,
      });

      if (retrievedKnowledge.length === 0) {
        return {
          sessionId: session.id,
          assistantMessage:
            "Vou confirmar esse ponto com nosso time e já te retorno certinho. Seu atendimento segue com o especialista por aqui.",
          leadState,
          context,
        };
      }

      const llmResult = await generateAssistantMessage({
        apiKey,
        model,
        temperature,
        context,
        userMessage,
        systemPrompt: buildSystemPrompt({
          customPrompt,
          stage: context.session.stage,
        }),
      });

      return {
        sessionId: session.id,
        assistantMessage: avoidRepeatedAssistantMessage(llmResult.text, messages),
        leadState,
        context,
      };
    }

    return {
      sessionId: session.id,
      assistantMessage: ESCALATED_CONFIRMATION,
      leadState,
      context: {
        prompt_version: "v2.1.0-amc",
      },
    };
  }

  await registrarEvento(session.id, leadState.lead_id, "user_message_received", {
    message: userMessage,
  });

  const extracted = extractLeadUpdatesFromMessage(userMessage);
  const preloadedUpdates = normalizePreloadedLead(preloadedLead);
  if (Object.keys(preloadedUpdates).length > 0) {
    for (const [key, value] of Object.entries(preloadedUpdates)) {
      if (!leadState[key] && value) {
        extracted[key] = value;
      }
    }
  }
  const sentiment = detectSentimentTags(userMessage);
  if (sentiment.negative) {
    extracted.sentimento = "negativo";
  }

  if (Object.keys(extracted).length > 0) {
    const merged = mergeLeadState(leadState, extracted, "confirmed");
    leadState = await (existingLead
      ? atualizarLead(session.id, leadState.lead_id, merged)
      : salvarLead(session.id, merged));
  } else if (!existingLead) {
    leadState = await salvarLead(session.id, leadState);
  }

  const classification = classifyLead(leadState);
  leadState = (await classificarLead(session.id, leadState.lead_id, classification)) || {
    ...leadState,
    ...classification,
  };

  const directTrigger = hasDirectEscalationTrigger(userMessage) || hasTradeDetails(userMessage);
  if (isPriceQuestion) {
    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      duvidas_pendentes: appendPendingQuestion(leadState.duvidas_pendentes, userMessage),
    })) || leadState;
  }
  const mustHandoff = shouldHandoff(leadState, userMessage, directTrigger);

  if (mustHandoff) {
    const handoffType = resolveHandoffType(leadState, userMessage, sentiment.negative);
    const handoffReason = resolveHandoffReason({
      isPriceQuestion,
      directTrigger,
      emotional: sentiment.negative,
      leadState,
    });
    const handoffMessage = resolveHandoffMessage({
      emotional: sentiment.negative,
      priceSpecific: isPriceQuestion,
      leadState,
    });

    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      escalonado: true,
      tipo_handoff: handoffType,
      handoff_motivo: handoffReason,
      handoff_prioritario: sentiment.negative,
      classificacao: "pronto_para_escalonamento",
      proximo_passo: "handoff_executado",
    })) || leadState;

    await acionarHandoff(session.id, leadState.lead_id, handoffReason);
    await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
      tipo_handoff: handoffType,
      payload: buildHandoffPayload(leadState, handoffReason, sentiment.tags),
    });

    try {
      const crmResult = await sincronizarCRM(session.id, leadState);
      await registrarEvento(session.id, leadState.lead_id, "crm_synced", crmResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro_crm";
      await registrarEvento(session.id, leadState.lead_id, "crm_sync_error", { message });
    }

    return {
      sessionId: session.id,
      assistantMessage: avoidRepeatedAssistantMessage(handoffMessage, []),
      leadState,
      context: {
        prompt_version: "v2.1.0-amc",
      },
    };
  }

  // Fluxo consultivo: para troca, peça um dado adicional antes de propor encaminhamento.
  if (
    leadState.metodo_negociacao === "troca" &&
    !leadState.detalhes_troca_solicitados &&
    !userAskedQuestion
  ) {
    const summary = summarizeLead(leadState);
    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      detalhes_troca_solicitados: true,
      resumo_conversa: summary,
    })) || leadState;

    return {
      sessionId: session.id,
      assistantMessage:
        "Perfeito, conseguimos seguir com troca sim. Para adiantar sua avaliação, me conta modelo e ano do seu Peugeot?",
      leadState,
      context: {
        prompt_version: "v2.1.1-amc",
      },
    };
  }

  let retrievedKnowledge = [];
  if (userAskedQuestion) {
    retrievedKnowledge = await consultarBaseConhecimento(session.id, leadState.lead_id, userMessage, 5, apiKey);
    await registrarEvento(session.id, leadState.lead_id, "knowledge_retrieved", {
      items: retrievedKnowledge.map((item) => item.id),
    });
    if (retrievedKnowledge.length === 0) {
      leadState = (await atualizarLead(session.id, leadState.lead_id, {
        duvidas_pendentes: appendPendingQuestion(leadState.duvidas_pendentes, userMessage),
      })) || leadState;
      await registrarEvento(session.id, leadState.lead_id, "unanswered_question_registered", {
        question: userMessage,
      });
    }
  }

  const messages = await listMessages(session.id, 40);
  const missingField = nextMissingField(leadState);
  const context = buildContext({
    leadState,
    session: (await getSession(session.id)) || session,
    messages,
    retrievedKnowledge,
    nextMissingField: missingField,
  });

  await registrarEvento(session.id, leadState.lead_id, "llm_context_built", {
    prompt_version: "v2.1.0-amc",
    stage: context.session.stage,
    next_missing_field: context.next_missing_field,
    retrieved_knowledge_count: context.retrieved_knowledge.length,
  });

  const llmResult = await generateAssistantMessage({
    apiKey,
    model,
    temperature,
    context,
    userMessage: isPriceQuestion ? `${userMessage}\n[POLITICA_PRECO_ESTOQUE]` : userMessage,
    systemPrompt: buildSystemPrompt({
      customPrompt,
      stage: context.session.stage,
    }),
  });
  const assistantMessage = avoidRepeatedAssistantMessage(llmResult.text, messages);

  const summary = summarizeLead(leadState);
  leadState = (await atualizarLead(session.id, leadState.lead_id, {
    resumo_conversa: summary,
  })) || leadState;

  await registrarEvento(session.id, leadState.lead_id, "assistant_message_generated", {
    stage: leadState.estagio,
    score: leadState.score,
  });

  return {
    sessionId: session.id,
    assistantMessage,
    leadState,
    context,
  };
}

function resolveHandoffType(leadState, message, emotional) {
  if (emotional) return "prioritario_emocional";
  if (leadState.metodo_negociacao === "financiamento" || message.toLowerCase().includes("financiamento")) {
    return "especialista_financiamento";
  }
  return "vendedor_comercial";
}

function resolveHandoffReason({ isPriceQuestion, directTrigger, emotional, leadState }) {
  if (emotional) return "emocao_negativa";
  if (directTrigger) return "gatilho_direto_cliente";
  if (isPriceQuestion && leadState.produto_interesse && leadState.metodo_negociacao) {
    return "preco_ou_condicao_especifica";
  }
  if (leadState.produto_interesse && leadState.metodo_negociacao) return "pronto_para_escalonamento";
  return "escalonamento_manual";
}

function resolveHandoffMessage({ emotional, priceSpecific }) {
  if (emotional) return ESCALATED_EMPATHETIC;
  if (priceSpecific) {
    return buildPricePolicyMessage();
  }
  return DEFAULT_HANDOFF_MESSAGE;
}

function buildHandoffPayload(leadState, handoffReason, sentimentTags) {
  return {
    informacoes_cliente: {
      nome: leadState.nome || "",
      telefone: leadState.telefone || "",
      email: leadState.email || "",
    },
    veiculo_interesse: leadState.produto_interesse || "",
    metodo_negociacao: leadState.metodo_negociacao || "",
    motivo_handoff: handoffReason,
    resumo: leadState.resumo_conversa || summarizeLead(leadState),
    sentimento: leadState.sentimento || "neutro",
    tags: sentimentTags || [],
    duvidas_cliente: leadState.duvidas_pendentes || [],
  };
}

function normalizePreloadedLead(preloadedLead) {
  if (!preloadedLead || typeof preloadedLead !== "object") return {};

  const nome = typeof preloadedLead.nome === "string" ? preloadedLead.nome.trim() : "";
  const produtoInteresse =
    typeof preloadedLead.produto_interesse === "string" ? preloadedLead.produto_interesse.trim() : "";
  const fonte = typeof preloadedLead.fonte === "string" ? preloadedLead.fonte.trim() : "";

  return {
    ...(nome ? { nome } : {}),
    ...(produtoInteresse ? { produto_interesse: produtoInteresse } : {}),
    ...(fonte ? { fonte } : {}),
  };
}

function appendPendingQuestion(list, question) {
  const current = Array.isArray(list) ? list : [];
  const normalized = String(question || "").trim();
  if (!normalized) return current;
  if (current.some((item) => String(item || "").trim().toLowerCase() === normalized.toLowerCase())) {
    return current;
  }
  return [...current, normalized].slice(-10);
}

function buildPricePolicyMessage(leadState = null) {
  const negotiationKnown = Boolean(leadState?.metodo_negociacao);
  const pullBack = negotiationKnown
    ? "Enquanto isso, quer que eu já sinalize ao especialista seu interesse nesse formato de negociação?"
    : "Enquanto isso, você prefere seguir por financiamento, troca ou à vista?";

  return `No pré-atendimento eu não consigo te confirmar valor e disponibilidade com precisão agora. Vou consultar o estoque para te responder certinho. ${pullBack}`;
}

function avoidRepeatedAssistantMessage(candidate, messages) {
  const text = String(candidate || "").trim();
  if (!text) return text;
  const lastAssistant = [...(messages || [])].reverse().find((item) => item.role === "assistant");
  if (!lastAssistant?.content) return text;

  const normalizedCurrent = normalize(text);
  const normalizedLast = normalize(lastAssistant.content);
  if (normalizedCurrent !== normalizedLast) return text;

  return `${text} Pode me confirmar só esse ponto para eu seguir com seu atendimento?`;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
