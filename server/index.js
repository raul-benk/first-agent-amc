import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { URL } from "node:url";
import { runEvalSuite } from "./evals.js";
import { computeOperationalMetrics } from "./observability.js";
import { runConversationTurn } from "./orchestrator.js";
import {
  appendMessage,
  getConversation,
  listEvalResults,
  listMessages,
  updateLead,
  upsertKnowledgeSource,
  upsertSession,
} from "./store.js";
import { registrarEvento } from "./tools.js";

const PORT = Number(process.env.AGENT_PORT || 3011);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || "");

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, payload, origin) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...buildCorsHeaders(origin),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpError(`Body excede o limite de ${MAX_BODY_BYTES} bytes.`, 413);
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("JSON invalido no body.", 400);
  }
}

function validateChatRequest(body) {
  if (!body || typeof body !== "object") {
    throw new HttpError("Body invalido.", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    throw new HttpError("Campo 'message' e obrigatorio.", 400);
  }

  return {
    conversationId:
      typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : randomUUID(),
    message,
    model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-5-mini",
    temperature:
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? body.temperature
        : 0.7,
    systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : "",
    preloadedLead:
      body.preloadedLead && typeof body.preloadedLead === "object"
        ? {
            nome:
              typeof body.preloadedLead.nome === "string" ? body.preloadedLead.nome.trim() : "",
            produto_interesse:
              typeof body.preloadedLead.produto_interesse === "string"
                ? body.preloadedLead.produto_interesse.trim()
                : "",
            fonte:
              typeof body.preloadedLead.fonte === "string" ? body.preloadedLead.fonte.trim() : "",
          }
        : null,
  };
}

function buildCorsHeaders(origin) {
  const resolvedOrigin = resolveAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": resolvedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
  };
}

function resolveAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return ALLOWED_ORIGINS[0] || "null";
}

function requiresAdminAuth(req) {
  if (!ADMIN_API_KEY) return false;
  const provided = String(req.headers["x-admin-key"] || "");
  return provided !== ADMIN_API_KEY;
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    return sendJson(res, 400, { error: "Requisicao invalida." }, req.headers.origin);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...buildCorsHeaders(req.headers.origin),
    });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(
      res,
      200,
      {
      ok: true,
      serverTime: new Date().toISOString(),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      },
      req.headers.origin,
    );
  }

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    try {
      const metrics = await computeOperationalMetrics();
      return sendJson(res, 200, metrics, req.headers.origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao calcular metricas.";
      return sendJson(res, 500, { error: message }, req.headers.origin);
    }
  }

  if (req.method === "GET" && url.pathname === "/api/evals/latest") {
    if (requiresAdminAuth(req)) {
      return sendJson(res, 401, { error: "Nao autorizado." }, req.headers.origin);
    }
    try {
      const results = await listEvalResults(20);
      return sendJson(res, 200, { results }, req.headers.origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao listar evals.";
      return sendJson(res, 500, { error: message }, req.headers.origin);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/evals/run") {
    if (requiresAdminAuth(req)) {
      return sendJson(res, 401, { error: "Nao autorizado." }, req.headers.origin);
    }
    try {
      const body = await readJsonBody(req);
      const output = await runEvalSuite({
        apiKey: process.env.OPENAI_API_KEY,
        model: typeof body.model === "string" ? body.model : "gpt-5-mini",
        temperature: typeof body.temperature === "number" ? body.temperature : 0.3,
        scenarios: Array.isArray(body.scenarios) ? body.scenarios : undefined,
      });
      return sendJson(res, 200, output, req.headers.origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao executar evals.";
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      return sendJson(res, statusCode, { error: message }, req.headers.origin);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge-sources") {
    if (requiresAdminAuth(req)) {
      return sendJson(res, 401, { error: "Nao autorizado." }, req.headers.origin);
    }
    try {
      const body = await readJsonBody(req);
      if (!body.id || !body.title || !body.content) {
        return sendJson(
          res,
          400,
          { error: "Campos obrigatorios: id, title, content." },
          req.headers.origin,
        );
      }

      const source = await upsertKnowledgeSource({
        id: String(body.id),
        source_type: String(body.source_type || "custom"),
        title: String(body.title),
        content: String(body.content),
        tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : [],
      });

      return sendJson(res, 200, { source }, req.headers.origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao inserir knowledge source.";
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      return sendJson(res, statusCode, { error: message }, req.headers.origin);
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/conversations/")) {
    const conversationId = url.pathname.replace("/api/conversations/", "").trim();
    if (!conversationId) {
      return sendJson(res, 400, { error: "conversationId invalido." }, req.headers.origin);
    }

    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return sendJson(res, 404, { error: "Conversa nao encontrada." }, req.headers.origin);
    }

    const messages = await listMessages(conversationId, 60);
    return sendJson(
      res,
      200,
      {
        conversationId,
        stage: conversation.stage,
        leadState: conversation.leadState,
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.created_at,
        })),
      },
      req.headers.origin,
    );
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const requestStarted = Date.now();

    try {
      const body = await readJsonBody(req);
      const parsed = validateChatRequest(body);
      const session = await upsertSession(parsed.conversationId);

      await appendMessage(session.id, "user", parsed.message);

      const result = await runConversationTurn({
        sessionId: session.id,
        userMessage: parsed.message,
        apiKey: process.env.OPENAI_API_KEY,
        model: parsed.model,
        temperature: parsed.temperature,
        customPrompt: parsed.systemPrompt,
        preloadedLead: parsed.preloadedLead,
      });

      if (mustForceFinanceHandoff(parsed.message, result.leadState)) {
        const patchedLead = (await updateLead(result.leadState.lead_id, {
          consentimento: true,
          escalonado: true,
          tipo_handoff: "especialista_financiamento",
          handoff_motivo: "dados_financeiros_coletados",
          classificacao: "pronto_para_escalonamento",
          estagio: "07_encaminhamento",
          proximo_passo: "handoff_executado",
        })) || result.leadState;

        result.leadState = patchedLead;
        result.assistantMessage = buildForcedFinanceHandoffMessage(patchedLead);
      }

      await appendMessage(session.id, "assistant", result.assistantMessage, {
        stage: result.leadState.estagio,
        score: result.leadState.score,
        classificacao: result.leadState.classificacao,
      });

      await registrarEvento(session.id, result.leadState.lead_id, "turn_finished", {
        latency_ms: Date.now() - requestStarted,
        prompt_version: result.context.prompt_version,
      });

      return sendJson(
        res,
        200,
        {
          conversationId: session.id,
          reply: result.assistantMessage,
          stage: result.leadState.estagio,
          score: result.leadState.score,
          classificacao: result.leadState.classificacao,
          proximoPasso: result.leadState.proximo_passo,
        },
        req.headers.origin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro interno.";
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      return sendJson(res, statusCode, { error: message }, req.headers.origin);
    }
  }

  return sendJson(res, 404, { error: "Rota nao encontrada." }, req.headers.origin);
});

server.listen(PORT, () => {
  console.log(`[agent-server] online em http://localhost:${PORT}`);
});

function mustForceFinanceHandoff(message, leadState) {
  const text = String(message || "").toLowerCase();
  const cpfInMessage = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(text) || /\b\d{11}\b/.test(text);
  const incomeInMessage =
    /renda(?:\s+mensal)?(?:\s+(?:e|eh|é|de)|\s*[:=])?\s*(r?\$?\s*\d[\d.,]*\s*(?:mil)?)/i.test(text);
  const financeIntent = text.includes("financiar") || text.includes("financiamento");
  const alreadyEscalated = Boolean(leadState?.escalonado);
  return cpfInMessage && incomeInMessage && financeIntent && !alreadyEscalated;
}

function buildForcedFinanceHandoffMessage(leadState) {
  const firstName = String(leadState?.nome || "").trim().split(/\s+/)[0] || "Perfeito";
  return `${firstName}, já encaminhei seus dados para o especialista financeiro seguir com seu atendimento e retornar com as melhores condições de aprovação, entrada e parcelas.`;
}
