import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listKnowledgeSources, updateKnowledgeEmbedding } from "./store.js";

const DEFAULT_EMBED_MODEL = process.env.RAG_EMBED_MODEL || "text-embedding-3-small";
const FAQ_FILE = path.resolve(process.cwd(), "assets", "faq-amc-veiculos.txt");
const VEHICLE_BASE_FILE = path.resolve(process.cwd(), "base-veiculos-amc.json");
let faqCache = null;
let vehicleCache = null;

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function dotProduct(a = [], b = []) {
  const size = Math.min(a.length, b.length);
  let total = 0;
  for (let idx = 0; idx < size; idx += 1) {
    total += a[idx] * b[idx];
  }
  return total;
}

function norm(vector = []) {
  return Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
}

function cosine(a = [], b = []) {
  const aNorm = norm(a);
  const bNorm = norm(b);
  if (!aNorm || !bNorm) return 0;
  return dotProduct(a, b) / (aNorm * bNorm);
}

function lexicalScore(query, source) {
  const tokens = tokenize(query);
  const haystack = `${source.title || ""} ${source.content || ""} ${(source.tags || []).join(" ")}`.toLowerCase();
  return tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
}

function sourceBoost(query, source) {
  const normalized = String(query || "").toLowerCase();
  const priceIntent =
    normalized.includes("preco") ||
    normalized.includes("preço") ||
    normalized.includes("valor") ||
    normalized.includes("quanto custa");
  const vehicleIntent =
    normalized.includes("tracker") ||
    normalized.includes("onix") ||
    normalized.includes("hb20") ||
    normalized.includes("civic") ||
    normalized.includes("corolla") ||
    normalized.includes("creta");

  if (source?.source_type === "vehicle_inventory" && (priceIntent || vehicleIntent)) {
    return 3;
  }
  return 0;
}

async function embedText(apiKey, text) {
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: DEFAULT_EMBED_MODEL,
    input: text,
  });

  const vector = response.data?.[0]?.embedding;
  return Array.isArray(vector) ? vector : null;
}

export async function retrieveKnowledgeHybrid({ apiKey, query, limit = 3 }) {
  const persistedSources = await listKnowledgeSources();
  const faqSources = await loadFaqSources();
  const vehicleSources = await loadVehicleSources();
  const sources = [...persistedSources, ...faqSources, ...vehicleSources];
  if (!sources.length) return [];

  const queryEmbedding = await embedText(apiKey, query);
  const scored = [];

  for (const source of sources) {
    const fullText = `${source.title || ""}\n${source.content || ""}`;
    let sourceEmbedding = source.embedding;

    if (queryEmbedding && !sourceEmbedding) {
      const generated = await embedText(apiKey, fullText);
      if (generated && source.id && !String(source.id).startsWith("faq_amc_")) {
        await updateKnowledgeEmbedding(source.id, generated, DEFAULT_EMBED_MODEL);
        sourceEmbedding = generated;
      }
    }

    const vector = queryEmbedding && sourceEmbedding ? cosine(queryEmbedding, sourceEmbedding) : 0;
    const lexical = lexicalScore(query, source);
    const boost = sourceBoost(query, source);
    const hybrid = queryEmbedding ? vector * 0.75 + lexical * 0.25 + boost : lexical + boost;

    scored.push({
      ...source,
      _score: hybrid,
    });
  }

  return scored
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...item }) => item);
}

async function loadFaqSources() {
  if (faqCache) return faqCache;

  try {
    const raw = await fs.readFile(FAQ_FILE, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sources = [];
    let currentQuestion = "";

    for (const line of lines) {
      if (line.startsWith("### ")) {
        currentQuestion = line.replace("### ", "").trim();
        continue;
      }

      if (currentQuestion && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("**")) {
        sources.push({
          id: `faq_amc_${sources.length + 1}`,
          source_type: "faq_amc",
          title: currentQuestion,
          content: normalizeFaqText(line),
          tags: ["faq", "amc", "comercial"],
          embedding: null,
          updated_at: new Date().toISOString(),
        });
        currentQuestion = "";
      }
    }

    faqCache = sources;
    return faqCache;
  } catch {
    faqCache = [];
    return faqCache;
  }
}

async function loadVehicleSources() {
  if (vehicleCache) return vehicleCache;

  try {
    const raw = await fs.readFile(VEHICLE_BASE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const vehicles = Array.isArray(parsed?.veiculos) ? parsed.veiculos : [];
    const emittedAt = String(parsed?.fonte?.emitido_em || "").trim();
    const updatedAt = emittedAt || new Date().toISOString();

    vehicleCache = vehicles
      .map((vehicle, index) => normalizeVehicleSource(vehicle, index, updatedAt))
      .filter(Boolean);

    return vehicleCache;
  } catch {
    vehicleCache = [];
    return vehicleCache;
  }
}

function normalizeVehicleSource(vehicle, index, updatedAt) {
  const marca = String(vehicle?.marca || "").trim();
  const modelo = String(vehicle?.modelo || "").trim();
  if (!marca && !modelo) return null;

  const ano = String(vehicle?.ano_fabricacao_modelo || "").trim();
  const placa = String(vehicle?.placa_chassi || "").trim();
  const km = Number(vehicle?.km || 0);
  const preco = Number(vehicle?.preco_avista_brl || 0);
  const combustivel = String(vehicle?.combustivel || "").trim();
  const diasEstoque = Number(vehicle?.dias_em_estoque || 0);
  const opcionais = String(vehicle?.opcionais || "").trim();
  const resumo = [
    `Marca: ${marca || "N/A"}`,
    `Modelo: ${modelo || "N/A"}`,
    ano ? `Ano: ${ano}` : "",
    placa ? `Placa/Chassi: ${placa}` : "",
    Number.isFinite(km) && km > 0 ? `KM: ${km}` : "",
    Number.isFinite(preco) && preco > 0 ? `Preco a vista BRL: ${preco}` : "",
    combustivel ? `Combustivel: ${combustivel}` : "",
    Number.isFinite(diasEstoque) && diasEstoque >= 0 ? `Dias em estoque: ${diasEstoque}` : "",
    opcionais ? `Opcionais: ${opcionais}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: `vehicle_inventory_${placa || index + 1}`,
    source_type: "vehicle_inventory",
    title: `${marca} ${modelo}`.trim(),
    content: resumo,
    tags: [
      "estoque",
      "veiculos",
      "amc",
      ...(marca ? [marca.toLowerCase()] : []),
      ...(combustivel ? [combustivel.toLowerCase()] : []),
      ...(ano ? [ano] : []),
      "preco",
      "valor",
      "km",
    ],
    embedding: null,
    updated_at: updatedAt,
  };
}

function normalizeFaqText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\bveiculo\b/gi, "veículo")
    .replace(/\bnao\b/gi, "não")
    .trim();
}
