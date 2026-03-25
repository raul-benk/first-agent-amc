import { randomUUID } from "node:crypto";
import { classifyLead, nextMissingField, shouldHandoff } from "./business-rules.js";
import { buildContext } from "./context-builder.js";
import {
  detectSentimentTags,
  extractLeadUpdatesFromMessage,
  hasDirectEscalationTrigger,
  hasPriceOrSpecificConditionQuestion,
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
  const financialFromTurn = extractFinancialDataFromMessage(userMessage);
  const userAskedQuestion = isQuestion(userMessage);
  const isPriceQuestion = hasPriceOrSpecificConditionQuestion(userMessage);
  const isVehicleDetailQuestion = hasVehicleDetailQuestion(userMessage);

  if (
    !leadState.escalonado &&
    hasFinancePayloadInMessage(userMessage, financialFromTurn) &&
    isFinanceContext(leadState, userMessage)
  ) {
    leadState = await (existingLead
      ? atualizarLead(session.id, leadState.lead_id, {
          ...(financialFromTurn.cpf ? { cpf: financialFromTurn.cpf } : {}),
          ...(financialFromTurn.renda_mensal ? { renda_mensal: financialFromTurn.renda_mensal } : {}),
          consentimento: true,
        })
      : salvarLead(session.id, mergeLeadState(leadState, {
          ...(financialFromTurn.cpf ? { cpf: financialFromTurn.cpf } : {}),
          ...(financialFromTurn.renda_mensal ? { renda_mensal: financialFromTurn.renda_mensal } : {}),
          consentimento: true,
        }, "confirmed")));

    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      escalonado: true,
      tipo_handoff: "especialista_financiamento",
      handoff_motivo: "dados_financeiros_coletados",
      handoff_prioritario: false,
      classificacao: "pronto_para_escalonamento",
      estagio: "07_encaminhamento",
      proximo_passo: "handoff_executado",
    })) || leadState;

    await acionarHandoff(session.id, leadState.lead_id, "dados_financeiros_coletados");
    await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
      tipo_handoff: "especialista_financiamento",
      payload: buildHandoffPayload(leadState, "dados_financeiros_coletados", []),
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
        assistantMessage: finalizeAssistantMessage(buildDirectFinanceHandoffMessage(leadState), leadState),
        leadState,
        context: {
          prompt_version: "v2.2.1-amc",
        },
      };
  }

  if (leadState.escalonado) {
    if (isPriceQuestion) {
      const vehicleInfo = await retrieveVehicleInfoForPrice({
        sessionId: session.id,
        leadId: leadState.lead_id,
        apiKey,
        userMessage,
        leadState,
      });
      const response = vehicleInfo
        ? buildVehiclePriceMessage(vehicleInfo, leadState)
        : "Tenho valores no estoque e te passo o mais próximo do modelo certo. Me confirma modelo e ano.";
      return {
        sessionId: session.id,
        assistantMessage: finalizeAssistantMessage(response, leadState),
        leadState,
        context: {
          prompt_version: "v2.1.0-amc",
        },
      };
    }

    if (isVehicleDetailQuestion && userAskedQuestion) {
      const vehicleInfo = leadState.veiculo_contexto
        ? leadState.veiculo_contexto
        : await retrieveVehicleInfoForPrice({
            sessionId: session.id,
            leadId: leadState.lead_id,
            apiKey,
            userMessage,
            leadState,
          });
      if (vehicleInfo) {
        return {
          sessionId: session.id,
          assistantMessage: finalizeAssistantMessage(
            buildVehicleDetailMessage(vehicleInfo, userMessage, leadState),
            leadState,
          ),
          leadState,
          context: {
            prompt_version: "v2.2.4-amc",
          },
        };
      }
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
          assistantMessage: finalizeAssistantMessage(
            "Não tenho esse detalhe com segurança agora. Vou confirmar com o vendedor e ele segue com você por aqui.",
            leadState,
          ),
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
      await logUsageEvent({
        sessionId: session.id,
        leadId: leadState.lead_id,
        model,
        usage: llmResult.usage,
      });

      return {
        sessionId: session.id,
        assistantMessage: finalizeAssistantMessage(
          avoidRepeatedAssistantMessage(llmResult.text, messages),
          leadState,
        ),
        leadState,
        context,
      };
    }

    return {
      sessionId: session.id,
      assistantMessage: finalizeAssistantMessage(ESCALATED_CONFIRMATION, leadState),
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

  const currentFinancialData = extractFinancialDataFromMessage(userMessage);
  if (shouldAutoEscalateFinance(leadState, userMessage, currentFinancialData)) {
    if (currentFinancialData.cpf || currentFinancialData.renda_mensal || leadState.consentimento !== true) {
      leadState = (await atualizarLead(session.id, leadState.lead_id, {
        ...(currentFinancialData.cpf ? { cpf: currentFinancialData.cpf } : {}),
        ...(currentFinancialData.renda_mensal ? { renda_mensal: currentFinancialData.renda_mensal } : {}),
        consentimento: true,
      })) || leadState;
    }

    const reason = "dados_financeiros_coletados";
    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      escalonado: true,
      tipo_handoff: "especialista_financiamento",
      handoff_motivo: reason,
      handoff_prioritario: false,
      classificacao: "pronto_para_escalonamento",
      estagio: "07_encaminhamento",
      proximo_passo: "handoff_executado",
    })) || leadState;

    await acionarHandoff(session.id, leadState.lead_id, reason);
    await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
      tipo_handoff: "especialista_financiamento",
      payload: buildHandoffPayload(leadState, reason, []),
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
      assistantMessage: finalizeAssistantMessage(buildDirectFinanceHandoffMessage(leadState), leadState),
      leadState,
      context: {
        prompt_version: "v2.2.0-amc",
      },
    };
  }

  if (isPriceQuestion && !leadState.escalonado) {
    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      duvidas_pendentes: appendPendingQuestion(leadState.duvidas_pendentes, userMessage),
    })) || leadState;

    const vehicleInfo = await retrieveVehicleInfoForPrice({
      sessionId: session.id,
      leadId: leadState.lead_id,
      apiKey,
      userMessage,
      leadState,
    });

    if (vehicleInfo) {
      leadState = (await atualizarLead(session.id, leadState.lead_id, {
        veiculo_contexto: buildVehicleContextPatch(vehicleInfo),
      })) || leadState;
    }

    return {
      sessionId: session.id,
      assistantMessage: finalizeAssistantMessage(
        vehicleInfo
          ? buildVehiclePriceMessage(vehicleInfo, leadState)
          : buildPriceScenarioMessage(leadState),
        leadState,
      ),
      leadState,
      context: { prompt_version: "v2.2.2-amc" },
    };
  }

  if (isVehicleDetailQuestion && userAskedQuestion && !leadState.escalonado) {
    const vehicleInfo = leadState.veiculo_contexto
      ? leadState.veiculo_contexto
      : await retrieveVehicleInfoForPrice({
          sessionId: session.id,
          leadId: leadState.lead_id,
          apiKey,
          userMessage,
          leadState,
        });

    if (vehicleInfo) {
      return {
        sessionId: session.id,
        assistantMessage: finalizeAssistantMessage(
          buildVehicleDetailMessage(vehicleInfo, userMessage, leadState),
          leadState,
        ),
        leadState,
        context: { prompt_version: "v2.2.3-amc" },
      };
    }
  }

  const tradeIntentInTurn = hasTradeIntent(userMessage);
  if (
    !leadState.escalonado &&
    !userAskedQuestion &&
    !leadState.detalhes_troca_solicitados &&
    (leadState.metodo_negociacao === "troca" || tradeIntentInTurn)
  ) {
    const summary = summarizeLead(leadState);
    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      metodo_negociacao: "troca",
      possui_troca: "sim",
      detalhes_troca_solicitados: true,
      resumo_conversa: summary,
    })) || leadState;

    const tradeModel = extractTradeModelMention(userMessage);
    const prompt = tradeModel
      ? `Perfeito, vamos considerar seu ${tradeModel}. Me passa ano, quilometragem e se está quitado?`
      : "Perfeito, seguimos com troca. Me fala modelo, ano, quilometragem e se está quitado?";

    if (tradeModel) {
      leadState = (await atualizarLead(session.id, leadState.lead_id, {
        troca_modelo: tradeModel,
      })) || leadState;
    }

    return {
      sessionId: session.id,
      assistantMessage: finalizeAssistantMessage(prompt, leadState),
      leadState,
      context: {
        prompt_version: "v2.2.6-amc",
      },
    };
  }

  if (
    !leadState.escalonado &&
    (leadState.metodo_negociacao === "troca" || leadState.possui_troca === "sim" || leadState.detalhes_troca_solicitados)
  ) {
    const tradePatch = extractTradeDetailsFromMessage(userMessage, leadState);
    if (Object.keys(tradePatch).length > 0) {
      leadState = (await atualizarLead(session.id, leadState.lead_id, tradePatch)) || leadState;
    }

    const missingTradeField = nextMissingTradeField(leadState);
    if (missingTradeField) {
      return {
        sessionId: session.id,
        assistantMessage: buildTradeCollectionMessage(missingTradeField, leadState),
        leadState,
        context: {
          prompt_version: "v2.2.7-amc",
        },
      };
    }

    if (leadState.consentimento === true) {
      const handoffReason = "dados_troca_coletados";
      leadState = (await atualizarLead(session.id, leadState.lead_id, {
        escalonado: true,
        tipo_handoff: "vendedor_comercial",
        handoff_motivo: handoffReason,
        handoff_prioritario: false,
        classificacao: "pronto_para_escalonamento",
        estagio: "07_encaminhamento",
        proximo_passo: "handoff_executado",
      })) || leadState;

      await acionarHandoff(session.id, leadState.lead_id, handoffReason);
      await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
        tipo_handoff: "vendedor_comercial",
        payload: buildHandoffPayload(leadState, handoffReason, sentiment.tags),
      });

      return {
        sessionId: session.id,
        assistantMessage:
          "Perfeito, com esses dados já vou encaminhar para o vendedor seguir com sua avaliação de troca.",
        leadState,
        context: {
          prompt_version: "v2.2.7-amc",
        },
      };
    }
  }

  const directTrigger = hasDirectEscalationTrigger(userMessage);
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
      estagio: "07_encaminhamento",
      proximo_passo: "handoff_executado",
    })) || leadState;

    await acionarHandoff(session.id, leadState.lead_id, handoffReason);
    await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
      tipo_handoff: handoffType,
      payload: buildHandoffPayload(leadState, handoffReason, sentiment.tags),
    });

    try {
      if (leadState.consentimento === true) {
        const crmResult = await sincronizarCRM(session.id, leadState);
        await registrarEvento(session.id, leadState.lead_id, "crm_synced", crmResult);
      } else {
        await registrarEvento(session.id, leadState.lead_id, "crm_sync_skipped", {
          reason: "consentimento_lgpd_ausente",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro_crm";
      await registrarEvento(session.id, leadState.lead_id, "crm_sync_error", { message });
    }

    return {
      sessionId: session.id,
      assistantMessage: finalizeAssistantMessage(
        avoidRepeatedAssistantMessage(handoffMessage, []),
        leadState,
      ),
      leadState,
      context: {
        prompt_version: "v2.1.0-amc",
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

      if (leadState.consentimento === true && !leadState.escalonado) {
        const handoffReason = "duvida_sem_base_confiavel";
        leadState = (await atualizarLead(session.id, leadState.lead_id, {
          escalonado: true,
          tipo_handoff: "vendedor_comercial",
          handoff_motivo: handoffReason,
          classificacao: "pronto_para_escalonamento",
          estagio: "07_encaminhamento",
          proximo_passo: "handoff_executado",
        })) || leadState;

        await acionarHandoff(session.id, leadState.lead_id, handoffReason);
        await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
          tipo_handoff: "vendedor_comercial",
          payload: buildHandoffPayload(leadState, handoffReason, sentiment.tags),
        });

        return {
          sessionId: session.id,
          assistantMessage: finalizeAssistantMessage(
            buildMissingInfoMessage({ transferred: true }),
            leadState,
          ),
          leadState,
          context: { prompt_version: "v2.2.5-amc" },
        };
      }

      return {
        sessionId: session.id,
        assistantMessage: finalizeAssistantMessage(
          buildMissingInfoMessage({ transferred: false }),
          leadState,
        ),
        leadState,
        context: { prompt_version: "v2.2.5-amc" },
      };
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
  await logUsageEvent({
    sessionId: session.id,
    leadId: leadState.lead_id,
    model,
    usage: llmResult.usage,
  });
  const assistantMessage = finalizeAssistantMessage(
    avoidRepeatedAssistantMessage(llmResult.text, messages),
    leadState,
  );

  if (shouldForceFinanceEscalation(userMessage, leadState)) {
    const financialFromTurn = extractFinancialDataFromMessage(userMessage);
    leadState = (await atualizarLead(session.id, leadState.lead_id, {
      ...(financialFromTurn.cpf ? { cpf: financialFromTurn.cpf } : {}),
      ...(financialFromTurn.renda_mensal ? { renda_mensal: financialFromTurn.renda_mensal } : {}),
      consentimento: true,
      escalonado: true,
      tipo_handoff: "especialista_financiamento",
      handoff_motivo: "dados_financeiros_coletados",
      classificacao: "pronto_para_escalonamento",
      estagio: "07_encaminhamento",
      proximo_passo: "handoff_executado",
    })) || leadState;

    await acionarHandoff(session.id, leadState.lead_id, "dados_financeiros_coletados");
    await registrarEvento(session.id, leadState.lead_id, "handoff_payload_ready", {
      tipo_handoff: "especialista_financiamento",
      payload: buildHandoffPayload(leadState, "dados_financeiros_coletados", []),
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
      assistantMessage: finalizeAssistantMessage(buildDirectFinanceHandoffMessage(leadState), leadState),
      leadState,
      context,
    };
  }

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
    info_financeira: {
      cpf_mascarado: maskCpf(leadState.cpf),
      renda_mensal: leadState.renda_mensal || "",
    },
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
    ? "Já acionei o vendedor para fechar a melhor condição nesse formato."
    : "Quer seguir por financiamento, troca ou à vista?";

  return `Já consultei o estoque e te passo os dados por aqui. ${pullBack}`;
}

function hasTradeIntent(message) {
  const text = normalize(message);
  return (
    text.includes("troca") ||
    text.includes("trocar") ||
    text.includes("meu usado") ||
    text.includes("dar na troca")
  );
}

function extractTradeModelMention(message) {
  const text = normalize(message);
  const knownMatch = text.match(
    /\b(onix|hb20|gol|corolla|civic|tracker|nivus|creta|renegade|t-cross|peugeot|clio|palio|fiesta|ka)\b/i,
  );
  if (knownMatch) {
    const model = String(knownMatch[1] || "").trim();
    return model ? model.charAt(0).toUpperCase() + model.slice(1).toLowerCase() : "";
  }

  const genericMatch = text.match(/(?:meu|minha)\s+([a-z0-9\- ]{2,25})/i);
  if (!genericMatch) return "";
  const raw = String(genericMatch[1] || "").trim();
  if (!raw || /\b(carro|veiculo|usado)\b/i.test(raw)) return "";
  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractTradeDetailsFromMessage(message, leadState) {
  const text = String(message || "");
  const lower = normalize(text);
  const patch = {};

  if (!leadState.troca_modelo) {
    const model = extractTradeModelMention(text);
    if (model) patch.troca_modelo = model;
  }

  if (!leadState.troca_ano) {
    const yearMatch = lower.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) patch.troca_ano = String(yearMatch[0]);
  }

  if (!leadState.troca_km) {
    const kmMatch = lower.match(/\b(\d{2,3})\s?mil\b|\b(\d{4,6})\s?km\b/);
    if (kmMatch) {
      if (kmMatch[1]) {
        patch.troca_km = String(Number(kmMatch[1]) * 1000);
      } else if (kmMatch[2]) {
        patch.troca_km = String(Number(kmMatch[2]));
      }
    }
  }

  if (!leadState.troca_quitado) {
    if (lower.includes("quitado") || lower.includes("quitada")) {
      patch.troca_quitado = "sim";
    } else if (
      lower.includes("financiado") ||
      lower.includes("financiada") ||
      lower.includes("em aberto")
    ) {
      patch.troca_quitado = "nao";
    }
  }

  return patch;
}

function nextMissingTradeField(leadState) {
  if (!leadState.troca_modelo) return "troca_modelo";
  if (!leadState.troca_ano) return "troca_ano";
  if (!leadState.troca_km) return "troca_km";
  if (!leadState.troca_quitado) return "troca_quitado";
  if (leadState.consentimento !== true) return "consentimento";
  return "";
}

function buildTradeCollectionMessage(missingField, leadState) {
  if (missingField === "troca_modelo") {
    return "Perfeito. Me confirma o modelo do seu carro para troca.";
  }
  if (missingField === "troca_ano") {
    return `Perfeito${leadState.troca_modelo ? `, ${leadState.troca_modelo}` : ""}. Qual é o ano dele?`;
  }
  if (missingField === "troca_km") {
    return "Anotado. Qual é a quilometragem aproximada?";
  }
  if (missingField === "troca_quitado") {
    return "Perfeito. Ele está quitado ou ainda financiado?";
  }
  return "Para seguir com a avaliação, você autoriza o uso dos seus dados?";
}

function buildMissingInfoMessage({ transferred = false } = {}) {
  if (transferred) {
    return "Não tenho esse detalhe com segurança agora. Já te transferi para o vendedor, e ele segue com você por aqui.";
  }
  return "Não tenho esse detalhe com segurança agora. Vou confirmar com o vendedor e te atualizo em seguida.";
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

function finalizeAssistantMessage(message, leadState) {
  let text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return text;

  const consentAlreadyGranted = leadState?.consentimento === true;
  if (consentAlreadyGranted) {
    const asksForConsent = /(autoriza|consentimento|lgpd)/i.test(text);
    if (asksForConsent) {
      text = text
        .replace(
          /(autoriza(?:[^\.\!\?]*)[\.\!\?]?)/gi,
          "",
        )
        .replace(
          /(consentimento(?:[^\.\!\?]*)[\.\!\?]?)/gi,
          "",
        )
        .replace(
          /(lgpd(?:[^\.\!\?]*)[\.\!\?]?)/gi,
          "",
        )
        .replace(/\s{2,}/g, " ")
        .trim();

      if (!text) {
        return "Perfeito, vou seguir com seu atendimento e já te passo o próximo passo.";
      }
    }
  }

  return text;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function shouldAutoEscalateFinance(leadState, userMessage, currentFinancialData = {}) {
  const text = String(userMessage || "").toLowerCase();
  const mentionsCpfAndIncome = text.includes("cpf") && text.includes("renda");
  const hasCpfAndIncome = Boolean(
    mentionsCpfAndIncome ||
      ((leadState.cpf || currentFinancialData.cpf) && (leadState.renda_mensal || currentFinancialData.renda_mensal)),
  );
  const financeIntent =
    leadState.metodo_negociacao === "financiamento" ||
    text.includes("financiar") ||
    text.includes("financiamento");
  const consentGranted =
    leadState.consentimento === true ||
    Boolean(currentFinancialData.cpf && (text.includes("pode sim") || text.includes("pode ser")));

  return consentGranted && financeIntent && hasCpfAndIncome && !leadState.escalonado;
}

function buildDirectFinanceHandoffMessage(leadState) {
  const firstName = String(leadState.nome || "").trim().split(/\s+/)[0] || "Perfeito";
  return `${firstName}, já vou encaminhar seus dados para o especialista financeiro seguir com seu atendimento e retornar com as melhores condições de aprovação, entrada e parcelas.`;
}

function buildPriceScenarioMessage(leadState) {
  if (!leadState.produto_interesse) {
    return "Me confirma o modelo e ano que eu já te passo o valor de estoque.";
  }

  if (!leadState.metodo_negociacao) {
    return "Tenho valor no estoque para esse modelo. O que você achou dele? Se quiser, eu te mostro outras opções também.";
  }

  return "Tenho valor no estoque para esse modelo. Se quiser, eu já te trago também opções de negociação.";
}

function buildVehiclePriceMessage(vehicleInfo, leadState) {
  const {
    title,
    price,
    year,
    km,
    fuel,
  } = vehicleInfo;

  const details = [
    year ? `ano ${year}` : "",
    Number.isFinite(km) && km > 0 ? `${km.toLocaleString("pt-BR")} km` : "",
    fuel ? `combustível ${fuel}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const baseLine = Number.isFinite(price) && price > 0
    ? `Encontrei em estoque: ${title} por R$ ${price.toLocaleString("pt-BR")}.`
    : `Encontrei em estoque: ${title}.`;

  if (!leadState.metodo_negociacao) {
    return `${baseLine}${details ? ` (${details}).` : ""} ${buildConsultativeVehicleFollowUp(leadState)}`;
  }

  return `${baseLine}${details ? ` (${details}).` : ""}`;
}

async function retrieveVehicleInfoForPrice({ sessionId, leadId, apiKey, userMessage, leadState }) {
  const queryParts = [
    userMessage,
    leadState?.produto_interesse || "",
    leadState?.intencao || "",
  ]
    .filter(Boolean)
    .join(" ");

  const knowledge = await consultarBaseConhecimento(sessionId, leadId, queryParts, 8, apiKey);
  const inventoryItems = knowledge.filter((item) => item.source_type === "vehicle_inventory");
  if (!inventoryItems.length) return null;

  const preferred = pickBestVehicleMatch(inventoryItems, queryParts);
  return parseVehicleInfo(preferred);
}

function pickBestVehicleMatch(items, query) {
  const normalizedQuery = normalize(query);
  const scored = items.map((item) => {
    const text = normalize(`${item.title} ${item.content}`);
    const score = normalizedQuery
      .split(/\s+/)
      .filter(Boolean)
      .reduce((acc, token) => (text.includes(token) ? acc + 1 : acc), 0);
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || items[0];
}

function parseVehicleInfo(item) {
  const title = String(item?.title || "").trim();
  const content = String(item?.content || "");
  const priceMatch = content.match(/Preco a vista BRL:\s*([0-9.]+)/i);
  const kmMatch = content.match(/KM:\s*([0-9.]+)/i);
  const yearMatch = content.match(/Ano:\s*([^|]+)/i);
  const fuelMatch = content.match(/Combustivel:\s*([^|]+)/i);
  const plateMatch = content.match(/Placa\/Chassi:\s*([^|]+)/i);

  return {
    id: String(item?.id || "").trim(),
    title,
    price: priceMatch ? Number(priceMatch[1].replace(/\./g, "")) : 0,
    km: kmMatch ? Number(kmMatch[1].replace(/\./g, "")) : 0,
    year: yearMatch ? yearMatch[1].trim() : "",
    fuel: fuelMatch ? fuelMatch[1].trim() : "",
    plate: plateMatch ? plateMatch[1].trim() : "",
  };
}

function buildVehicleContextPatch(vehicleInfo) {
  return {
    id: vehicleInfo.id || "",
    title: vehicleInfo.title || "",
    price: Number(vehicleInfo.price || 0),
    km: Number(vehicleInfo.km || 0),
    year: vehicleInfo.year || "",
    fuel: vehicleInfo.fuel || "",
    plate: vehicleInfo.plate || "",
  };
}

function buildVehicleDetailMessage(vehicleInfo, userMessage, leadState) {
  const text = normalize(userMessage);
  if (text.includes("km") || text.includes("quilometragem")) {
    if (Number.isFinite(vehicleInfo.km) && vehicleInfo.km > 0) {
      return `${vehicleInfo.title} está com ${vehicleInfo.km.toLocaleString("pt-BR")} km.${leadState.metodo_negociacao ? "" : " Você pretende financiar ou usar troca?"}`;
    }
  }

  if (text.includes("ano")) {
    if (vehicleInfo.year) {
      return `${vehicleInfo.title} é ano ${vehicleInfo.year}.${leadState.metodo_negociacao ? "" : " Você pretende financiar ou usar troca?"}`;
    }
  }

  if (text.includes("combustivel") || text.includes("combustível")) {
    if (vehicleInfo.fuel) {
      return `${vehicleInfo.title} é ${vehicleInfo.fuel}.${leadState.metodo_negociacao ? "" : " Você pretende financiar ou usar troca?"}`;
    }
  }

  if (text.includes("placa") || text.includes("chassi")) {
    return "Esse dado eu confirmo direto com o vendedor por segurança. O que você achou desse veículo? Se quiser, te apresento outras opções parecidas.";
  }

  return buildVehiclePriceMessage(vehicleInfo, leadState);
}

function buildConsultativeVehicleFollowUp(leadState) {
  if (leadState?.metodo_negociacao === "troca") {
    return "O que você achou desse veículo? Se quiser, eu te mostro outras opções para comparar.";
  }
  return "O que você achou desse veículo? Quer que eu te apresente outras opções também?";
}

function hasVehicleDetailQuestion(message) {
  const text = normalize(message);
  return (
    text.includes("quilometragem") ||
    text.includes(" km") ||
    text.startsWith("km") ||
    text.includes("ano") ||
    text.includes("combustivel") ||
    text.includes("combustível") ||
    text.includes("placa") ||
    text.includes("chassi")
  );
}

function maskCpf(cpf) {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) return "";
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function extractFinancialDataFromMessage(message) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const cpfDigits = text.replace(/\D/g, "").match(/\d{11}/)?.[0] || "";
  const incomeMatch = lower.match(
    /renda(?:\s+mensal)?(?:\s+(?:e|eh|é|de)|\s*[:=])?\s*(r?\$?\s*\d[\d.,]*\s*(?:mil)?)/i,
  );
  const renda_mensal = parseIncomeRaw(incomeMatch?.[1] || "");

  return {
    cpf: cpfDigits.length === 11 ? cpfDigits : "",
    renda_mensal,
  };
}

function parseIncomeRaw(rawIncome) {
  const raw = String(rawIncome || "").replace(/\s+/g, "").replace("r$", "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("mil")) {
    const base = Number(raw.replace("mil", "").replace(",", "."));
    if (Number.isFinite(base) && base > 0) return String(Math.round(base * 1000));
    return "";
  }

  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Math.round(value));
}

function shouldForceFinanceEscalation(userMessage, leadState) {
  const text = String(userMessage || "").toLowerCase();
  const financialFromTurn = extractFinancialDataFromMessage(userMessage);
  const hasFinancialData = hasFinancePayloadInMessage(userMessage, financialFromTurn);
  const financeContext = isFinanceContext(leadState, userMessage);

  return hasFinancialData && financeContext && !leadState.escalonado;
}

function hasFinancePayloadInMessage(userMessage, extracted = null) {
  const text = String(userMessage || "").toLowerCase();
  const fromTurn = extracted || extractFinancialDataFromMessage(userMessage);
  return Boolean((text.includes("cpf") && text.includes("renda")) || (fromTurn.cpf && fromTurn.renda_mensal));
}

function isFinanceContext(leadState, userMessage) {
  const text = String(userMessage || "").toLowerCase();
  return (
    leadState.metodo_negociacao === "financiamento" ||
    leadState.intencao === "financiamento" ||
    text.includes("financiar") ||
    text.includes("financiamento")
  );
}

async function logUsageEvent({ sessionId, leadId, model, usage }) {
  if (!usage) return;

  await registrarEvento(sessionId, leadId, "llm_usage", {
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    estimated_cost_usd: estimateCostUsd(model, usage),
  });
}

function estimateCostUsd(model, usage) {
  const pricing = {
    "gpt-5-mini": { input: 0.00000025, output: 0.000002 },
    "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
  };
  const configured = pricing[String(model || "").toLowerCase()];
  if (!configured) return 0;

  const inputCost = Number(usage.input_tokens || 0) * configured.input;
  const outputCost = Number(usage.output_tokens || 0) * configured.output;
  return Number((inputCost + outputCost).toFixed(8));
}
