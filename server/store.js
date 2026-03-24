import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const DB_FILE = process.env.AGENT_STORE_PATH || path.resolve(process.cwd(), "data", "conversations.json");

let writeQueue = Promise.resolve();

function defaultData() {
  return {
    sessions: {},
    messages: {},
    leads: {},
    lead_states: [],
    tool_calls: [],
    events: [],
    knowledge_sources: defaultKnowledgeSources(),
    eval_results: [],
    crm_syncs: [],
    conversations: {},
  };
}

function defaultKnowledgeSources() {
  const now = new Date().toISOString();
  return [
    {
      id: "faq_financiamento",
      source_type: "faq",
      title: "Financiamento",
      content:
        "A analise de financiamento depende de dados pessoais e renda. O prazo de retorno normalmente ocorre no mesmo dia util.",
      tags: ["financiamento", "analise", "documentacao"],
      embedding: null,
      updated_at: now,
    },
    {
      id: "institucional_horario",
      source_type: "institucional",
      title: "Horario de atendimento",
      content: "Atendimento comercial de segunda a sabado, das 8h as 18h.",
      tags: ["horario", "atendimento", "loja"],
      embedding: null,
      updated_at: now,
    },
    {
      id: "playbook_pre_qualificacao",
      source_type: "playbook",
      title: "Playbook de pre-qualificacao",
      content:
        "Antes do handoff para vendas, confirmar nome, contato, intencao, produto de interesse, orcamento e prazo.",
      tags: ["playbook", "qualificacao", "vendas"],
      embedding: null,
      updated_at: now,
    },
  ];
}

async function ensureStoreFile() {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });

  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(defaultData(), null, 2), "utf8");
  }
}

function migrateLegacy(parsed) {
  const base = {
    ...defaultData(),
    ...(parsed || {}),
  };

  if (!base.sessions || typeof base.sessions !== "object") base.sessions = {};
  if (!base.messages || typeof base.messages !== "object") base.messages = {};
  if (!base.leads || typeof base.leads !== "object") base.leads = {};
  if (!Array.isArray(base.lead_states)) base.lead_states = [];
  if (!Array.isArray(base.tool_calls)) base.tool_calls = [];
  if (!Array.isArray(base.events)) base.events = [];
  if (!Array.isArray(base.knowledge_sources)) base.knowledge_sources = defaultKnowledgeSources();
  if (!Array.isArray(base.eval_results)) base.eval_results = [];
  if (!Array.isArray(base.crm_syncs)) base.crm_syncs = [];
  if (!base.conversations || typeof base.conversations !== "object") base.conversations = {};

  const legacyConversations = parsed?.conversations;
  if (legacyConversations && typeof legacyConversations === "object") {
    for (const [sessionId, conversation] of Object.entries(legacyConversations)) {
      if (!base.sessions[sessionId]) {
        base.sessions[sessionId] = {
          id: sessionId,
          lead_id: conversation?.leadState?.lead_id || randomUUID(),
          stage: conversation?.stage || "01_abertura",
          created_at: conversation?.createdAt || new Date().toISOString(),
          updated_at: conversation?.updatedAt || new Date().toISOString(),
          status: "active",
          summary: "",
        };
      }

      if (!base.messages[sessionId]) {
        base.messages[sessionId] = (conversation?.messages || []).map((msg) => ({
          id: msg.id || randomUUID(),
          role: msg.role,
          content: msg.content,
          created_at: msg.createdAt || new Date().toISOString(),
        }));
      }

      const leadId = base.sessions[sessionId].lead_id;
      if (!base.leads[leadId]) {
        const previous = conversation?.leadState || {};
        base.leads[leadId] = {
          ...previous,
          lead_id: leadId,
          session_id: sessionId,
        };
      }
    }
  }

  return base;
}

async function readStore() {
  await ensureStoreFile();
  const raw = await fs.readFile(DB_FILE, "utf8");

  if (!raw.trim()) return defaultData();

  try {
    return migrateLegacy(JSON.parse(raw));
  } catch {
    return defaultData();
  }
}

async function writeStore(data) {
  await ensureStoreFile();
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

function queueWrite(mutator) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });

  return writeQueue;
}

export async function upsertSession(sessionId) {
  return queueWrite((store) => {
    const now = new Date().toISOString();
    const id = sessionId || randomUUID();

    if (!store.sessions[id]) {
      store.sessions[id] = {
        id,
        lead_id: randomUUID(),
        stage: "01_abertura",
        created_at: now,
        updated_at: now,
        status: "active",
        summary: "",
      };
    } else {
      store.sessions[id].updated_at = now;
    }

    if (!store.messages[id]) {
      store.messages[id] = [];
    }

    return store.sessions[id];
  });
}

export async function getSession(sessionId) {
  const store = await readStore();
  return store.sessions[sessionId] || null;
}

export async function appendMessage(sessionId, role, content, metadata = {}) {
  return queueWrite((store) => {
    const now = new Date().toISOString();

    if (!store.sessions[sessionId]) {
      store.sessions[sessionId] = {
        id: sessionId,
        lead_id: randomUUID(),
        stage: "01_abertura",
        created_at: now,
        updated_at: now,
        status: "active",
        summary: "",
      };
    }

    if (!store.messages[sessionId]) {
      store.messages[sessionId] = [];
    }

    const message = {
      id: randomUUID(),
      role,
      content,
      metadata,
      created_at: now,
    };

    store.messages[sessionId].push(message);
    store.sessions[sessionId].updated_at = now;

    return message;
  });
}

export async function listMessages(sessionId, limit = 40) {
  const store = await readStore();
  const list = store.messages[sessionId] || [];
  const start = Math.max(0, list.length - limit);
  return list.slice(start);
}

export async function getLead(leadId) {
  const store = await readStore();
  return store.leads[leadId] || null;
}

export async function saveLead(leadState) {
  return queueWrite((store) => {
    store.leads[leadState.lead_id] = leadState;
    store.lead_states.push({
      id: randomUUID(),
      lead_id: leadState.lead_id,
      session_id: leadState.session_id,
      stage: leadState.estagio,
      state: leadState,
      created_at: new Date().toISOString(),
    });

    if (store.sessions[leadState.session_id]) {
      store.sessions[leadState.session_id].stage = leadState.estagio;
      store.sessions[leadState.session_id].summary = leadState.resumo_conversa || "";
      store.sessions[leadState.session_id].updated_at = new Date().toISOString();
    }

    return leadState;
  });
}

export async function updateLead(leadId, patch) {
  return queueWrite((store) => {
    const lead = store.leads[leadId];
    if (!lead) return null;

    const next = {
      ...lead,
      ...patch,
      updated_at: new Date().toISOString(),
    };

    store.leads[leadId] = next;
    store.lead_states.push({
      id: randomUUID(),
      lead_id: next.lead_id,
      session_id: next.session_id,
      stage: next.estagio,
      state: next,
      created_at: new Date().toISOString(),
    });

    if (store.sessions[next.session_id]) {
      store.sessions[next.session_id].stage = next.estagio;
      store.sessions[next.session_id].summary = next.resumo_conversa || "";
      store.sessions[next.session_id].updated_at = new Date().toISOString();
    }

    return next;
  });
}

export async function addToolCall(call) {
  return queueWrite((store) => {
    const item = {
      id: randomUUID(),
      ...call,
      created_at: new Date().toISOString(),
    };
    store.tool_calls.push(item);
    return item;
  });
}

export async function addEvent(event) {
  return queueWrite((store) => {
    const item = {
      id: randomUUID(),
      ...event,
      created_at: new Date().toISOString(),
    };
    store.events.push(item);
    return item;
  });
}

export async function queryKnowledge(query, limit = 3) {
  const store = await readStore();
  const normalized = (query || "").toLowerCase();

  const scored = (store.knowledge_sources || []).map((item) => {
    const haystack = `${item.title} ${item.content} ${(item.tags || []).join(" ")}`.toLowerCase();
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const score = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
    return {
      ...item,
      _score: score,
    };
  });

  return scored
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...item }) => item);
}

export async function addEvalResult(result) {
  return queueWrite((store) => {
    const item = {
      id: randomUUID(),
      ...result,
      created_at: new Date().toISOString(),
    };

    store.eval_results.push(item);
    return item;
  });
}

export async function addCrmSync(sync) {
  return queueWrite((store) => {
    const item = {
      id: randomUUID(),
      ...sync,
      created_at: new Date().toISOString(),
    };
    store.crm_syncs.push(item);
    return item;
  });
}

export async function listKnowledgeSources() {
  const store = await readStore();
  return store.knowledge_sources || [];
}

export async function upsertKnowledgeSource(source) {
  return queueWrite((store) => {
    const now = new Date().toISOString();
    const idx = (store.knowledge_sources || []).findIndex((item) => item.id === source.id);
    const normalized = {
      embedding: null,
      tags: [],
      ...source,
      updated_at: now,
    };

    if (idx >= 0) {
      store.knowledge_sources[idx] = {
        ...store.knowledge_sources[idx],
        ...normalized,
      };
      return store.knowledge_sources[idx];
    }

    store.knowledge_sources.push(normalized);
    return normalized;
  });
}

export async function updateKnowledgeEmbedding(sourceId, embedding, embeddingModel) {
  return queueWrite((store) => {
    const item = (store.knowledge_sources || []).find((source) => source.id === sourceId);
    if (!item) return null;

    item.embedding = embedding;
    item.embedding_model = embeddingModel;
    item.updated_at = new Date().toISOString();
    return item;
  });
}

export async function listEvents(limit = 1000) {
  const store = await readStore();
  const list = store.events || [];
  const start = Math.max(0, list.length - limit);
  return list.slice(start);
}

export async function listToolCalls(limit = 1000) {
  const store = await readStore();
  const list = store.tool_calls || [];
  const start = Math.max(0, list.length - limit);
  return list.slice(start);
}

export async function listLeads() {
  const store = await readStore();
  return Object.values(store.leads || {});
}

export async function listSessions() {
  const store = await readStore();
  return Object.values(store.sessions || {});
}

export async function listEvalResults(limit = 100) {
  const store = await readStore();
  const list = store.eval_results || [];
  const start = Math.max(0, list.length - limit);
  return list.slice(start);
}

export async function getConversation(sessionId) {
  const store = await readStore();
  const session = store.sessions[sessionId];
  if (!session) return null;

  return {
    id: session.id,
    stage: session.stage,
    leadState: store.leads[session.lead_id] || null,
    messages: store.messages[sessionId] || [],
  };
}
