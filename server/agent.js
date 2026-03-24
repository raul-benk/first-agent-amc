import OpenAI from "openai";

function modelSupportsTemperature(model) {
  return !model.startsWith("gpt-5");
}

export async function generateAgentReply({
  apiKey,
  model,
  temperature,
  systemPrompt,
  history,
  userMessage,
}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada no backend.");
  }

  const client = new OpenAI({ apiKey });

  const input = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...history.map((msg) => ({ role: msg.role, content: msg.content })),
    {
      role: "user",
      content: userMessage,
    },
  ];

  const payload = {
    model,
    input,
  };

  if (modelSupportsTemperature(model)) {
    payload.temperature = temperature;
  }

  const response = await client.responses.create(payload);
  const outputText = response.output_text?.trim();

  if (!outputText) {
    throw new Error("Modelo retornou resposta vazia.");
  }

  return outputText;
}
