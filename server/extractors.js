const PHONE_REGEX = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})-?\d{4}/g;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const NEGATIVE_EMOTION_HINTS = [
  "nervoso",
  "chateado",
  "irritado",
  "indignado",
  "decepcionado",
  "insatisfeito",
  "pessimo",
  "horrivel",
  "ridiculo",
];

const INTENT_MAP = [
  { value: "agendar_visita", hints: ["agendar", "visita", "test drive"] },
  { value: "falar_com_vendedor", hints: ["vendedor", "humano", "atendente"] },
  { value: "financiamento", hints: ["financiamento", "financiar", "entrada"] },
  { value: "trocar_veiculo", hints: ["troca", "meu usado", "dar na troca"] },
  { value: "duvida_geral", hints: ["duvida", "como funciona", "informacao"] },
  { value: "comprar", hints: ["comprar", "tenho interesse", "quero esse"] },
];

const NEGOTIATION_METHOD_HINTS = [
  { value: "financiamento", hints: ["financiamento", "financiar", "entrada"] },
  { value: "troca", hints: ["troca", "meu usado", "dar na troca"] },
  { value: "a_vista", hints: ["a vista", "pix", "ted", "transferencia"] },
  { value: "cartao", hints: ["cartao", "parcelado"] },
  { value: "agendar_visita", hints: ["agendar visita", "ir na loja"] },
  { value: "falar_com_vendedor", hints: ["falar com vendedor", "falar com especialista"] },
];

export function extractLeadUpdatesFromMessage(message) {
  const text = (message || "").trim();
  const lower = text.toLowerCase();
  const updates = {};

  const phones = text.match(PHONE_REGEX);
  if (phones?.length) updates.telefone = phones[0];

  const emails = text.match(EMAIL_REGEX);
  if (emails?.length) updates.email = emails[0].toLowerCase();

  const nomeMatch = text.match(/(?:meu nome e|sou o|sou a|me chamo)\s+([A-Za-zÀ-ÿ'\- ]{2,60})/i);
  if (nomeMatch) updates.nome = sanitizeText(nomeMatch[1]);

  const vehicle = extractVehicleInterest(text);
  if (vehicle) updates.produto_interesse = vehicle;

  const intention = inferByHints(lower, INTENT_MAP);
  if (intention) updates.intencao = intention;

  const method = inferByHints(lower, NEGOTIATION_METHOD_HINTS);
  if (method) updates.metodo_negociacao = method;

  if (lower.includes("sem troca") || lower.includes("nao tenho troca") || lower.includes("primeiro carro")) {
    updates.possui_troca = "nao";
  } else if (lower.includes("com troca") || lower.includes("tenho troca") || lower.includes("dar na troca")) {
    updates.possui_troca = "sim";
  }

  if (isNegativeEmotion(lower)) {
    updates.sentimento = "negativo";
  }

  return updates;
}

export function isQuestion(message) {
  const text = (message || "").trim();
  if (!text) return false;
  return text.includes("?") || /\b(quanto|qual|como|quando|onde|tem|possui|aceita|preco|valor)\b/i.test(text);
}

export function hasPriceOrSpecificConditionQuestion(message) {
  const lower = (message || "").toLowerCase();
  return (
    lower.includes("preco final") ||
    lower.includes("valor final") ||
    lower.includes("melhor preco") ||
    lower.includes("condicao especial") ||
    lower.includes("desconto final")
  );
}

export function hasDirectEscalationTrigger(message) {
  const lower = (message || "").toLowerCase();
  return (
    lower.includes("quero proposta") ||
    lower.includes("me manda proposta") ||
    lower.includes("agendar visita") ||
    lower.includes("quero visitar") ||
    lower.includes("falar com vendedor") ||
    lower.includes("pode encaminhar") ||
    lower.includes("pode passar para o vendedor") ||
    lower.includes("quero falar com especialista")
  );
}

export function hasTradeDetails(message) {
  const lower = (message || "").toLowerCase();
  const hasYear = /\b(19|20)\d{2}\b/.test(lower);
  const hasKm = /\b\d{2,3}\s?mil\b|\b\d{4,6}\s?km\b/.test(lower);
  const mentionsModel = /\b(onix|hb20|gol|corolla|civic|tracker|nivus|creta|renegade|t-cross)\b/.test(lower);
  const tradeValueHint =
    lower.includes("valor do meu usado") ||
    lower.includes("valor da troca") ||
    lower.includes("quanto vale o meu");
  return mentionsModel || hasYear || hasKm || lower.includes("financiamento em aberto") || tradeValueHint;
}

export function detectSentimentTags(message) {
  const lower = (message || "").toLowerCase();
  const tags = NEGATIVE_EMOTION_HINTS.filter((token) => lower.includes(token));
  return {
    negative: tags.length > 0,
    tags,
  };
}

function extractVehicleInterest(text) {
  const explicit = text.match(
    /(?:veiculo|carro|modelo|interesse|quero)\s*(?:de interesse|:|e|eh)?\s*([A-Za-z0-9À-ÿ'\- ]{2,60})/i,
  );
  if (explicit) return sanitizeText(explicit[1]);
  return "";
}

function inferByHints(lower, map) {
  const item = map.find((entry) => entry.hints.some((hint) => lower.includes(hint)));
  return item ? item.value : "";
}

function isNegativeEmotion(lower) {
  return NEGATIVE_EMOTION_HINTS.some((hint) => lower.includes(hint));
}

function sanitizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}
