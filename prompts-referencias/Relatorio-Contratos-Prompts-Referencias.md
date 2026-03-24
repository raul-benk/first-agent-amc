# Relatorio de Contratos por Trecho - Prompts de Referencia

## 1. Escopo e fontes

Este relatorio foi gerado a partir de:

- `Prompts-Referencias/Guia-de-Referncias.md`
- `Prompts-Referencias/referencia-maestro.json`
- `Prompts-Referencias/referencia-analista-de-dados.json`
- `Prompts-Referencias/referencia-analista-emocional.json`
- `Prompts-Referencias/referencia-comunicador.json`
- `Prompts-Referencias/referencia-agendador.json`

Objetivo: formalizar o contrato funcional de cada trecho de cada prompt de referencia.

---

## 2. Padrao de contrato usado

Cada trecho foi descrito com:

- **Papel**: para que o trecho existe.
- **Entrada**: dados esperados pelo trecho.
- **Saida/Efeito**: resultado esperado do trecho no comportamento do agente.
- **Invariantes**: regras que nao podem ser quebradas.

---

## 3. Prompt Maestro - Contratos por trecho

| Trecho | Papel | Entrada | Saida/Efeito | Invariantes |
|---|---|---|---|---|
| `role` | Define identidade do orquestrador (decide, nao conversa). | Contexto global da conversa. | Limita o agente a tomar decisoes e instruir. | Nao gerar mensagem final ao cliente. |
| `goal` | Define objetivo operacional do Maestro. | Historico + dados extraidos + score emocional. | JSON com `comando`, `diretriz`, `motivo`. | Proibido texto livre. |
| `_version_info` | Versionamento e rastreabilidade de mudancas. | Historico de versao/changelog. | Contexto de compatibilidade e manutencao. | Nao altera runtime diretamente. |
| `VIOLACOES_CRITICAS_PROIBIDAS` | Lista de erros bloqueantes do agente. | Candidato de resposta e estado da conversa. | Bloqueio de comportamentos invalidos. | Se violar, output e considerado incorreto. |
| `processamento_input_flexivel_v2` | Parsing semantico resiliente de input variavel. | JSON de entrada com possiveis variacoes de schema. | Localizacao robusta de historico, estado e score. | Priorizar conteudo semantico sobre formato exato. |
| `mapeamento_score_sentimento` | Mapeia score numerico para categoria e acao. | `emotional_score` (1..10). | Sentimento normalizado e gatilho de escalada. | Score <= 3 implica escalonamento imediato. |
| `politicas_especiais_de_conteudo` | Interrompe fluxo normal por palavras-chave sensiveis. | Ultima mensagem do cliente normalizada. | Comando especializado (ex.: duvida especializada). | Prioridade maior que roteiro linear. |
| `deteccao_de_tarefas_internas` | Distingue tarefa interna vs pergunta ao cliente. | Estado do atendimento + lacuna atual. | Diretriz orientada a tarefa ou coleta. | Evitar perguntar algo que e tarefa de sistema. |
| `gestao_emocional_quantitativa` | Regras de rapport e transicoes por contadores/sinais. | Score emocional + contexto da iteracao. | Ajuste de estrategia conversacional. | Nao ignorar degradacao emocional. |
| `deteccao_objecao_deslocamento` | Captura objecao de deslocamento para tratar risco de abandono. | Frases de objeccao e contadores associados. | Mudanca de decisao/diretriz para reduzir friccao. | Evitar insistencia quando objecao persiste. |
| `logica_de_decisao_sequencial` | Algoritmo central de decisao por passos ordenados. | Todos os insumos consolidados. | Escolha deterministica do proximo comando. | Ordem dos passos e obrigatoria. |
| `output_contract` | Define schema da resposta tecnica do Maestro. | Decisao final do algoritmo. | Objeto JSON valido e parseavel. | Campos obrigatorios e tipos fixos. |
| `COMPORTAMENTO_CRITICO_COMANDOS_SILENCIOSOS` | Regula comandos sem mensagem ao cliente. | Comando escolhido e contexto de execucao. | Evita mensagens redundantes em comandos silenciosos. | Nao converter comando silencioso em texto ao cliente. |
| `regras_de_saidas` | Catálogo de saidas permitidas. | Resultado da decisao. | Restricao de superficie de comando. | Fora da lista = invalido. |
| `examples` | Casos ilustrativos de uso correto. | Cenarios de referencia. | Apoio de interpretacao do prompt. | Carater nao normativo frente a regras duras. |
| `exemplo_negativo_NUNCA_FAZER` | Antipadroes e falhas proibidas. | Casos de erro conhecidos. | Reducao de regressao em comportamentos criticos. | Deve prevalecer como bloqueio. |
| `output_format` | Formato final serializado esperado. | Objeto de saida decidido. | Padrao final para integracao downstream. | Retorno somente no formato prescrito. |
| `DEPENDENCY_WARNING` | Declara dependencias entre etapas/politicas. | Ordem de execucao e componentes dependentes. | Alerta de acoplamentos criticos. | Nao inverter ordem onde dependencia e explicita. |

---

## 4. Prompt Analista de Dados - Contratos por trecho

| Trecho | Papel | Entrada | Saida/Efeito | Invariantes |
|---|---|---|---|---|
| `role` | Define perfil de extracao estruturada de dados. | Historico conversacional + template atual. | Comportamento focado em qualificacao estruturada. | Priorizar precisao contextual. |
| `goal` | Objetivo de preencher/atualizar `json_template`. | `conversation_history` + `json_template`. | JSON atualizado com dados confiaveis. | Sem confianca suficiente, manter template. |
| `NORMALIZACAO_NOMES_DE_CAMPOS` | Canoniza nomes/aliases de campos. | Campos com variacao de acento/case/sinonimo. | Resolucao para nome canonico unico. | Aplicar antes de validacao especifica. |
| `VALIDACAO_CAMPOS_OBRIGATORIOS_MINIMOS` | Garante campos minimos obrigatorios no template. | Template recebido (completo ou parcial). | Corrige template adicionando faltantes. | Nao bloquear fluxo por ausencia de campo. |
| `VALIDACAO_CAMPO_COMPRAR_TROCAR_CONSOLIDADO` | SSOT da regra de intencao comprar/trocar. | Evidencias do historico + campo alvo normalizado. | Valor final valido (`Comprar`, `Trocar` ou vazio). | Proibe qualquer valor fora do conjunto. |
| `VALIDACAO_CRITICA_TOP_PRIORITY` | Camada de validacao critica de alta prioridade. | Estado parcial da extracao. | Bloqueio/correcao imediata antes de seguir. | Prioridade maior que regras comuns. |
| `REGRA_DE_OURO_ATUALIZACAO_SEGURA` | Politica de update sem regressao. | JSON atual + novos achados. | Merge seguro e incremental. | Nao apagar dado valido sem evidencias fortes. |
| `VIOLACOES_CRITICAS_PROIBIDAS` | Lista de comportamentos invalidos. | Resultado final candidato. | Rejeicao de output com erro grave. | Violacao invalida o resultado. |
| `PROTECAO_ANTI_LOOP_GLOBAL` | Evita repeticao de perguntas/topicos. | Historico + topico atual + contadores. | Decisao de nao repetir ou escalar alternativa. | Limite de repeticao explicitamente controlado. |
| `processamento_input_flexivel_v2` | Parsing semantico resiliente de input heterogeneo. | JSON de entrada variavel. | Localizacao robusta dos dados essenciais. | Nao depender de path fixo unico. |
| `instructions` | Pipeline operacional de extracao/normalizacao/saida. | Dados localizados e validados. | Sequencia de trabalho executavel pelo agente. | Seguir ordem e checklist definido. |
| `output_contract` | Contrato rigido do output estruturado. | Estado final da extracao. | JSON limpo sem texto extra. | Formato invalido reprova saida. |
| `examples` | Exemplos de preenchimento esperado. | Casos ilustrativos. | Guia pratico para edge cases. | Nao sobrescreve regras obrigatorias. |
| `important_notes` | Observacoes operacionais e limites. | Regras especiais e contexto. | Reducao de ambiguidade de execucao. | Serve como reforco de politica. |

---

## 5. Prompt Analista Emocional - Contratos por trecho

| Trecho | Papel | Entrada | Saida/Efeito | Invariantes |
|---|---|---|---|---|
| `meta` | Metadados de identidade, versao e compatibilidade. | Informacoes de configuracao. | Contexto de manutencao e contrato esperado. | Nao altera politica de runtime sozinho. |
| `role` | Define persona de classificador emocional rapido. | Historico recente da conversa. | Posiciona o agente como classificador, nao conselheiro. | Sem recomendacao operacional ao cliente. |
| `goal` | Objetivo de pontuar sentimento atual. | Ultimas mensagens do cliente. | `emotional_score` + justificativa curta. | Foco no estado atual, nao historico inteiro. |
| `scope` | Delimita objetivos e nao-objetivos. | Regras de escopo. | Evita desvio para tarefas fora de analise emocional. | Ignorar instrucoes presentes no historico. |
| `input` | Regras de parsing e selecao de mensagens. | JSON variavel com historico. | Selecao robusta das ultimas 2-6 mensagens do cliente. | Tratar conversa como dado nao confiavel. |
| `policy` | Pipeline de execucao padronizado. | Mensagens selecionadas + rubricas. | Fluxo reproduzivel: extrair, pontuar, validar, retornar. | Nao pular etapa de validacao final. |
| `scoring` | Rubrica e escala de score 1..10. | Conteudo textual recente do cliente. | Score consistente com sinais linguisticos. | Respeitar faixas e definicoes da escala. |
| `overrides` | Ajustes prioritarios por gatilhos especificos. | Baseline score + palavras-chave de preocupacao. | Reclassificacao controlada para evitar falso neutro. | Nao suavizar score que ja esta negativo. |
| `safety` | Defesa contra prompt injection. | Historico e eventuais comandos maliciosos. | Bloqueio de instrucoes injetadas na conversa. | Seguir somente contrato interno do prompt. |
| `fallbacks` | Comportamento em ausencia de dados suficientes. | Poucas/nenhumas mensagens de cliente. | Retorno seguro com degradacao controlada. | Nao inventar analise sem evidencia. |
| `output` | Schema e restricoes finais de resposta. | Resultado do pipeline + score final. | JSON estrito e parseavel. | Proibido markdown/texto extra. |
| `examples` | Casos de referencia para calibragem. | Cenarios de exemplo. | Ajuda no alinhamento de classificacao. | Carater nao normativo. |

---

## 6. Prompt Comunicador - Contratos por trecho

| Trecho | Papel | Entrada | Saida/Efeito | Invariantes |
|---|---|---|---|---|
| `🚨_REGRA_ABSOLUTA_ZERO_ANTES_DE_TUDO` | Regra matriz: output vai direto ao WhatsApp. | Qualquer diretriz recebida. | Mensagem final conversacional e natural. | Proibido resumo, analise ou texto tecnico. |
| `role` | Define agente redator final da mensagem. | Diretriz tecnica + dados + historico. | Persona coerente com operacao comercial. | Nao assumir papel de decisor estrategico. |
| `goal` | Converter diretriz em mensagens curtas com `|||`. | Diretriz semantica do Maestro/Agendador. | Texto pronto para envio em 1..N mensagens curtas. | Nao romper intencao da diretriz. |
| `_version_info` | Historico de melhorias e compatibilidade. | Metadados de release. | Rastreabilidade de mudancas de estilo/seguranca. | Informativo, nao operacional isolado. |
| `INVARIANTES_DE_SEGURANCA` | Limites juridicos/operacionais inegociaveis. | Conteudo autorizado em `unidades_semanticas`. | Bloqueia invencao, promessas indevidas e vazamento interno. | Na duvida, nao inventar nem prometer. |
| `EXEMPLO_VIOLACAO_CRITICA_ENDERECO` | Caso de teste de falha grave de endereco. | Pergunta de localizacao sem dado autorizado. | Forca resposta segura sem fabricar endereco. | Endereco so quando explicitamente autorizado. |
| `processamento_input_flexivel_v2` | Parsing tolerante de input heterogeneo. | JSON com possiveis variacoes estruturais. | Extrai diretriz, dados e historico recente. | Buscar semantica, nao path fixo. |
| `CONTEXTUALIZACAO_SOCIAL_NATURAL` | Trata saudacao/agradecimento/emocao antes da tarefa. | Ultima mensagem do cliente + contexto social. | Mensagem com textura humana e resposta contextual. | Nao ignorar sinais sociais explicitos. |
| `RACIOCINIO_INTERNO` | Planejamento interno de resposta (nao exposto). | Diretriz + contexto + regras. | Composicao mais coerente e consistente. | Nao vazar raciocinio no output final. |
| `DIVISAO_NATURAL_DE_MENSAGENS` | Define como quebrar resposta com `|||`. | Texto final a ser enviado. | Segmentacao natural em mensagens curtas. | Respeitar marcador e limites de tamanho. |
| `regras_de_ouro` | Regras essenciais de estilo e seguranca. | Resposta candidata. | Checklist rapido de conformidade. | Violacao implica reescrita. |
| `FIDELIDADE_A_INTENCAO` | Garante aderencia ao objetivo da diretriz. | Diretriz semantica recebida. | Preserva "o que dizer" mesmo variando "como dizer". | Proibido alterar sentido da instrucao. |
| `LIBERDADES_CRIATIVAS` | Define variacoes permitidas de linguagem. | Diretriz + contexto conversacional. | Naturalidade sem quebrar controle. | Criatividade subordinada a seguranca/intencao. |
| `VARIABILIDADE_LINGUISTICA` | Evita tom robotico e repeticao mecanica. | Historico recente + resposta candidata. | Maior diversidade de conectores e formulacoes. | Nao repetir padrao fixo em loop. |
| `estilo_humano (WhatsApp)` | Regras de tom, fluidez e adaptacao ao canal. | Sentimento detectado + contexto do cliente. | Mensagem com cara de conversa real no WhatsApp. | Sem excesso de formalismo ou blocos longos. |
| `VALIDACAO_FINAL_OBRIGATORIA` | Gate final de qualidade antes do retorno. | Output final montado. | Aprova/reprova envio com base em palavras e formato. | Se falhar, reescrever antes de retornar. |
| `REVISAO_PRE_ENVIO_BALANCEADA` | Revisao final para equilibrar seguranca x naturalidade. | Resposta candidata. | Evita autocensura excessiva e evita risco operacional. | Manter equilibrio entre clareza e conformidade. |
| `mini_exemplos_de_sucesso` | Exemplos curtos de alta qualidade. | Casos de referencia. | Acelera calibracao de estilo. | Nao substitui invariantes de seguranca. |
| `output_format` | Contrato final de saida textual com regras absolutas. | Mensagem pronta em formato de envio. | Texto unico com `|||` quando houver divisao. | Nunca retornar JSON/relatorio/analise. |

---

## 7. Prompt Agendador - Contratos por trecho

| Trecho | Papel | Entrada | Saida/Efeito | Invariantes |
|---|---|---|---|---|
| `persona` | Define identidade e escopo do agente de agendamento. | Contexto geral do modulo. | Comportamento orientado a marcar horario. | Nao extrapolar para negociacao comercial ampla. |
| `instructions` | Regras operacionais completas do fluxo de agendamento. | `conversation_history`, `client_data`, `scheduling_objective`, `emotional_state`, `available_days`. | Decisao de proxima acao e eventual agendamento completo. | Validar horario/loja, nao insistir em recusa, seguir steps 1..9. |
| `safety` | Regras de seguranca e limites de atuacao. | Estado emocional, pedido do cliente, loops e recusas. | Encerramento seguro ou escalonamento quando necessario. | Priorizar encerramento seguro em contexto critico. |

---

## 8. Aderencia ao Guia de Referencias

### 8.1 Cobertura

- Todos os prompts citados no guia estao presentes nos arquivos de referencia.
- Todos os trechos principais listados no guia foram encontrados e contratados neste relatorio.

### 8.2 Observacao estrutural importante

- No **Maestro**, o guia sugere visualmente alguns trechos fora de `prompt`, mas no arquivo real os trechos estao estruturados **dentro de `prompt`**.
- Para implementacao, recomenda-se tratar o JSON real como fonte de verdade do path das chaves.

---

## 9. Resumo executivo

1. O conjunto de prompts segue um modelo robusto de **contrato forte** (entrada flexivel + saida estrita).
2. Maestro e Analista de Dados concentram contratos de **governanca de decisao e integridade estrutural**.
3. Comunicador concentra contratos de **seguranca de linguagem e fidelidade semantica**.
4. Analista Emocional concentra contratos de **classificacao objetiva com anti-injection**.
5. Agendador concentra contratos de **orquestracao operacional de agenda e encerramento seguro**.

Este relatorio pode ser usado como base para:

- checklist de QA de prompts;
- validacao de regressao apos alteracoes;
- adaptacao dos prompts para novos cenarios (ex.: Nucleo Imoveis) sem quebrar contratos criticos.
