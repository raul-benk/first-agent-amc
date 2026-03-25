# AI Lead Pre-Atendimento - Guia Técnico de Validação

## 1. Objetivo

Este projeto implementa um agente de IA para pré-atendimento e qualificação de leads, seguindo o PRD técnico com:

- orquestração stateful
- estado estruturado persistente
- tools para ações externas
- contexto controlado para LLM
- observabilidade e evals iniciais

## 2. Status de aderência ao PRD

### 2.1 MVP e Fase 2 implementados

- Conversação natural em português: **OK**
- Estado estruturado do lead persistente: **OK**
- Fluxo stateful e classificação básica/avançada: **OK**
- Regras de negócio fora do LLM: **OK**
- Tool calling interno (`salvar_lead`, `atualizar_lead`, `classificar_lead`, `consultar_base_conhecimento`, `acionar_handoff`, `registrar_evento`, `consultar_agenda`, `sincronizar_crm`): **OK**
- RAG híbrido (lexical + embeddings): **OK**
- Observabilidade (eventos, tool_calls, latência, custo estimado): **OK**
- Evals com API: **OK**
- Dashboard operacional no frontend: **OK**

### 2.2 Implementação parcial (pontos esperados de evolução)

- Persistência em JSON (não SQL/NoSQL de produção): **PARCIAL**
- Integração CRM via webhook genérico (sem conector nativo HubSpot/Pipedrive): **PARCIAL**
- Segurança de produção (auth, RBAC, criptografia forte de dados sensíveis em repouso): **PARCIAL**
- Evals ainda focadas em cenários base (sem benchmark amplo por segmento): **PARCIAL**

## 3. Arquitetura atual

```text
Frontend (React/Vite)
  -> Backend HTTP (Node)
    -> Orchestrator Stateful
      -> Context Builder
      -> LLM (OpenAI Responses API)
      -> Tools
         -> Persistência JSON (sessions/messages/leads/...)
         -> RAG (knowledge_sources + embeddings)
         -> CRM webhook
      -> Observability / Metrics / Evals
```

## 4. Endpoints disponíveis

### 4.1 Core

- `GET /api/health`
- `POST /api/chat`
- `GET /api/conversations/:id`

### 4.2 Fase 2

- `GET /api/metrics`
- `GET /api/evals/latest`
- `POST /api/evals/run`
- `POST /api/knowledge-sources`

## 5. Pré-requisitos

- Node.js 18+ (recomendado 20+)
- npm 9+
- arquivo `.env` na raiz de `ai-assistant-studio-main`

## 6. Configuração de ambiente

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

2. Configure variáveis:

```env
OPENAI_API_KEY=...            # opcional para modo fallback sem LLM externo
AGENT_PORT=3011               # opcional (backend)
VITE_DEV_PORT=3010            # opcional (frontend)
# VITE_API_PROXY_TARGET=http://localhost:3011
AGENT_STORE_PATH=./data/conversations.json
CRM_WEBHOOK_URL=              # opcional
CRM_API_KEY=                  # opcional
RAG_EMBED_MODEL=text-embedding-3-small
```

## 7. Como rodar

Terminal 1 (backend):

```bash
npm run dev:server
```

Terminal 2 (frontend):

```bash
npm run dev
```

Ou execute tudo com um comando:

```bash
npm run dev:all
```

Aplicação:

- frontend: `http://localhost:3010` (ou `VITE_DEV_PORT`)
- backend: `http://localhost:3011`

## 8. Validação técnica (automatizada)

### 8.1 Testes e build

```bash
npm test
npm run build
```

### 8.2 Smoke test de APIs

```bash
curl -s http://localhost:3011/api/health
curl -s http://localhost:3011/api/metrics
curl -s -X POST http://localhost:3011/api/evals/run -H 'Content-Type: application/json' -d '{}'
```

## 9. Validação funcional (manual)

1. Abra o frontend e envie mensagens no chat.
2. Verifique evolução de estágio, score e classificação no retorno do backend (`/api/chat`).
3. Abra a aba `Operações` e confirme atualização de métricas e evals.
4. Cadastre fonte de conhecimento:

```bash
curl -s -X POST http://localhost:3011/api/knowledge-sources \
  -H 'Content-Type: application/json' \
  -d '{"id":"faq_entrega","title":"Entrega","content":"Entrega em ate 5 dias uteis.","tags":["entrega"]}'
```

5. Faça uma pergunta relacionada no chat para validar recuperação de contexto.
6. Se `CRM_WEBHOOK_URL` estiver configurada, valide eventos `crm_synced` em `data/conversations.json`.

## 10. Já podemos testar?

**Sim.** O sistema está apto para testes de homologação técnica e funcional no escopo PRD (MVP + Fase 2 implementada neste repositório).

Condição mínima para homologar:

- backend e frontend sobem sem erro
- `/api/chat`, `/api/metrics`, `/api/evals/run` respondem
- dashboard de operações exibe dados
- fluxo de coleta e qualificação funciona em conversas reais

## 11. Limites atuais antes de produção

- Persistência em arquivo JSON (single-node, sem concorrência distribuída)
- Sem autenticação de API
- Sem mascaramento avançado/criptografia de PII em repouso
- Custos de LLM por estimativa (não billing real)

## 12. Próximos passos recomendados

1. Migrar persistência para Postgres + migrações versionadas.
2. Adicionar autenticação e autorização por tenant.
3. Implementar mascaramento de dados sensíveis em logs.
4. Integrar conector CRM nativo (ex.: HubSpot/Pipedrive).
5. Expandir suíte de evals com cenários por segmento comercial.
