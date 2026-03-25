import OpenAI from "openai";

function modelSupportsTemperature(model) {
  return !model.startsWith("gpt-5");
}

export async function generateAssistantMessage({
  apiKey,
  model,
  temperature,
  context,
  userMessage,
  systemPrompt,
}) {
  if (!apiKey) {
    return {
      text: fallbackReply(context, userMessage),
      usage: null,
    };
  }

  const client = new OpenAI({ apiKey });
  const systemInstruction =
    typeof systemPrompt === "string" && systemPrompt.trim()
      ? systemPrompt.trim()
      : [
          "Voce e um agente de pre-atendimento e qualificacao de leads.",
          "Responda em portugues brasileiro, objetivo e natural.",
          "Nao invente fatos comerciais sem base no contexto recuperado.",
          "Faca no maximo 1 pergunta por turno.",
          "Nao abra a conversa pedindo consentimento LGPD; colete contexto primeiro e solicite consentimento apenas no momento de usar dados sensiveis.",
          "Se consentimento LGPD ja estiver no contexto, nao repita o pedido.",
          "Evite pergunta com muitas opcoes na mesma frase.",
          "Se houver proximo_passo de encaminhamento, proponha handoff sem bloquear o usuario.",
          "Quando houver dados de veiculo no contexto recuperado, informe preco e detalhes de forma curta.",
        ].join(" ");

  const payload = {
    model,
    input: [
      {
        role: "system",
        content: `${systemInstruction}\n\nCONTEXTO ESTRUTURADO:\n${JSON.stringify(context, null, 2)}`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  };

  if (modelSupportsTemperature(model)) {
    payload.temperature = temperature;
  }

  const response = await client.responses.create(payload);
  const text = response.output_text?.trim();
  const usage = normalizeUsage(response.usage);
  return {
    text: text || fallbackReply(context, userMessage),
    usage,
  };
}

function fallbackReply(context, userMessage) {
  const missingField = context.next_missing_field;
  const askedQuestion = /[?]|(\bquanto\b|\bqual\b|\bcomo\b|\bonde\b|\bpreco\b|\bvalor\b)/i.test(
    String(userMessage || ""),
  );
  const priceLike = /(\bpreco\b|\bvalor\b|\bcondicao\b|\bestoque\b|\bdisponi)/i.test(
    String(userMessage || ""),
  );

  if (priceLike) {
    return "Consigo te passar valor com base no estoque. Me confirma só modelo e ano para eu te responder certo.";
  }

  if (askedQuestion) {
    return "Ótima pergunta. Se eu não tiver esse detalhe com segurança, confirmo com o vendedor e te atualizo aqui.";
  }

  const prompts = {
    consentimento: [
      "Antes de continuar, voce autoriza o uso dos seus dados para seguirmos com seu atendimento?",
      "Para eu seguir com seu atendimento, voce concorda com o uso dos seus dados conforme a LGPD?",
    ],
    intencao: [
      "Me conta seu objetivo com esse veículo para eu te direcionar do melhor jeito.",
      "Perfeito. Como você quer seguir com esse atendimento hoje?",
    ],
    produto_interesse: [
      "Qual veículo você está buscando hoje?",
      "Qual modelo chamou mais sua atenção?",
    ],
    metodo_negociacao: [
      "Você já tem em mente como prefere negociar esse veículo?",
      "Qual formato de negociação faz mais sentido para você nesse momento?",
    ],
  };

  if (missingField && prompts[missingField]) {
    const options = prompts[missingField];
    const index = Math.abs(hashCode(`${context.session?.id || "0"}:${missingField}`)) % options.length;
    return options[index];
  }

  if (context.lead_state.classificacao === "pronto_para_escalonamento") {
    return "Perfeito, vou te encaminhar agora para um especialista da AMC Veículos seguir com você.";
  }

  return "Perfeito. Me conta um pouco mais para eu te direcionar ao especialista certo.";
}

function hashCode(text) {
  let hash = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(idx);
    hash |= 0;
  }
  return hash;
}

function normalizeUsage(usage) {
  if (!usage) return null;

  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}
