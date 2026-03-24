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
  upsertKnowledgeSource,
  upsertSession,
} from "./store.js";
import { registrarEvento } from "./tools.js";

const PORT = Number(process.env.AGENT_PORT || 3001);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSON invalido no body.");
  }
}

function validateChatRequest(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Body invalido.");
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    throw new Error("Campo 'message' e obrigatorio.");
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

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    return sendJson(res, 400, { error: "Requisicao invalida." });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    try {
      const metrics = await computeOperationalMetrics();
      return sendJson(res, 200, metrics);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao calcular metricas.";
      return sendJson(res, 500, { error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/evals/latest") {
    try {
      const results = await listEvalResults(20);
      return sendJson(res, 200, { results });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao listar evals.";
      return sendJson(res, 500, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/evals/run") {
    try {
      const body = await readJsonBody(req);
      const output = await runEvalSuite({
        apiKey: process.env.OPENAI_API_KEY,
        model: typeof body.model === "string" ? body.model : "gpt-5-mini",
        temperature: typeof body.temperature === "number" ? body.temperature : 0.3,
        scenarios: Array.isArray(body.scenarios) ? body.scenarios : undefined,
      });
      return sendJson(res, 200, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao executar evals.";
      return sendJson(res, 500, { error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge-sources") {
    try {
      const body = await readJsonBody(req);
      if (!body.id || !body.title || !body.content) {
        return sendJson(res, 400, { error: "Campos obrigatorios: id, title, content." });
      }

      const source = await upsertKnowledgeSource({
        id: String(body.id),
        source_type: String(body.source_type || "custom"),
        title: String(body.title),
        content: String(body.content),
        tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : [],
      });

      return sendJson(res, 200, { source });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao inserir knowledge source.";
      return sendJson(res, 500, { error: message });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/conversations/")) {
    const conversationId = url.pathname.replace("/api/conversations/", "").trim();
    if (!conversationId) {
      return sendJson(res, 400, { error: "conversationId invalido." });
    }

    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return sendJson(res, 404, { error: "Conversa nao encontrada." });
    }

    const messages = await listMessages(conversationId, 60);
    return sendJson(res, 200, {
      conversationId,
      stage: conversation.stage,
      leadState: conversation.leadState,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.created_at,
      })),
    });
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

      await appendMessage(session.id, "assistant", result.assistantMessage, {
        stage: result.leadState.estagio,
        score: result.leadState.score,
        classificacao: result.leadState.classificacao,
      });

      await registrarEvento(session.id, result.leadState.lead_id, "turn_finished", {
        latency_ms: Date.now() - requestStarted,
        prompt_version: result.context.prompt_version,
      });

      return sendJson(res, 200, {
        conversationId: session.id,
        reply: result.assistantMessage,
        stage: result.leadState.estagio,
        score: result.leadState.score,
        classificacao: result.leadState.classificacao,
        proximoPasso: result.leadState.proximo_passo,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro interno.";
      return sendJson(res, 400, { error: message });
    }
  }

  return sendJson(res, 404, { error: "Rota nao encontrada." });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[agent-server] online em http://localhost:${PORT}`);
});
