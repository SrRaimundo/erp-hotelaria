# Governança participativa (checklist, chamados, frigobar, setores) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o "marcar limpo" por checklists de saída e de arrumação no celular da camareira, com chamados (defeito/reposição), avisos de controle faltando, frigobar lançado na conta e setor em todo lançamento.

**Architecture:** Novo módulo de servidor `apps/server/src/governanca/` (modelos, execuções, chamados, frigobar) que usa os serviços existentes de quartos, conta e alertas; setores entram como coluna em `lancamentos` e tabela `produto_setores`. Na interface, um fluxo de checklist por etapas em `apps/web/src/telas/governanca/checklist/` com rascunho no `localStorage`, e blocos novos na tela Hoje e no painel da reserva.

**Tech Stack:** o mesmo dos Planos A e B1 (Node 24, Fastify 5, Kysely + SQLite, zod, Vitest; React 19, React Router 7, TanStack Query 5, Vite, Testing Library, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-24-governanca-checklist-design.md`. Base: specs e decisões dos Planos A e B1 (`docs/superpowers/plans/2026-10-22-plano-a-decisoes-e-pendencias.md`, `docs/superpowers/plans/2026-10-23-plano-b1-decisoes-e-pendencias.md`).

## Global Constraints

- Branch de trabalho: `plano-b1-interface` (a governança é construída sobre o B1, ainda não integrado ao `master`).
- Migrações novas na faixa `0500_governanca*`; preservar finais de linha dos arquivos editados.
- Execuções de checklist, respostas e `frigobar_movimentos`: somente inserção. `chamados`: única atualização permitida é `aberto → resolvido | cancelado`. `lancamentos.setor` nasce com o lançamento e nunca muda.
- Setores fixos: `hospedagem`, `recepcao`, `frigobar`, `bar`, `restaurante`. Rótulos: Hospedagem, Recepção, Frigobar, Bar, Restaurante.
- Etapas e respostas: `limpeza` (sim/não), `enxoval` (inteiro ≥ 0), `equipamento` (`funciona` | `nao_funciona` | `nao_se_aplica`), `controles` (`presente` | `faltando` | `nao_se_aplica`).
- Tipos de chamado: `defeito` (impede Liberado) e `reposicao` (não impede). Situações: `aberto`, `resolvido`, `cancelado`.
- Permissões: checklist e chamados/avisos próprios → `quartos.situacao`; resolver chamados, liberar quarto → `quartos.manutencao`; formulário rápido de frigobar → `conta.lancar`; opção `camareiraLancaFrigobar` → `config.gerenciar`.
- Textos, cores e regras de interface do B1 continuam valendo (tokens, pt-BR, dinheiro em centavos, mensagens da API junto da ação, contrato de URL da gaveta).

## Review Focus

1. **Camareira alterna "Não funciona" ↔ "Funciona" várias vezes** → no máximo um chamado aberto por item no checklist; desmarcar cancela o anterior. (Teste na Task 7.)
2. **Dois aparelhos concluem a saída do mesmo quarto** → o segundo recebe `QUARTO_NAO_SUJO` e nada é gravado em duplicidade. (Teste na Task 4.)
3. **Hóspede faz check-out enquanto a camareira está no meio da arrumação** → ao concluir, `QUARTO_NAO_OCUPADO` ou `CONTA_FECHADA`; nada gravado; rascunho mantido com a mensagem. (Testes nas Tasks 4 e 7.)
4. **Rascunho antigo de um quarto que já mudou de situação** (outra pessoa liberou) → ao reabrir, o rascunho é descartado com aviso. (Teste na Task 7.)
5. **Quantidade digitada absurda no frigobar ou enxoval** (ex.: 50) → acima de 20 pede confirmação antes de seguir. (Teste na Task 7.)

---

## Estrutura de arquivos

```
apps/server/src/
  governanca/  modelos.ts  checklists.ts  chamados.ts  frigobar.ts  migracao.ts  rotas.ts
  hospedagem/  conta.ts (setor)  virada.ts, checkin.ts, checkout.ts (setor hospedagem)  governanca.ts (liberar, lista)  consultas.ts (painel)  reservas.ts (ultimaArrumacao)
  nucleo/      produtos.ts (setores)  pousada.ts (camareiraLancaFrigobar)  quartos.ts (sujo→bloqueado)
  demo.ts
apps/web/src/
  lib/setores.ts
  telas/reserva/  FormLancarExtra.tsx (setor)  AbaConta.tsx (coluna Setor)  FormFrigobar.tsx
  telas/governanca/  TelaGovernanca.tsx  checklist/{FluxoChecklist,EtapaSimNao,EtapaContagem,EtapaEquipamentos,EtapaControles,EtapaFrigobar,EtapaResultado,rascunho}.ts(x)
  telas/hoje/  BlocoChamados.tsx  BlocoGovernanca.tsx
  apps/web/e2e/governanca.spec.ts
```

---

### Task 1: Servidor — setores nos lançamentos e nos produtos

**Files:**
- Create: `apps/server/src/governanca/migracao.ts` (primeira migração `0500_governanca_setores`), register in `src/shared/migracoes.ts`
- Modify: `apps/server/src/hospedagem/conta.ts` (`NovoLancamento.setor`, `LinhaExtrato.setor`), `hospedagem/virada.ts`, `hospedagem/checkin.ts`, `hospedagem/checkout.ts`, `hospedagem/rotas.ts` (corpo de lançamento), `nucleo/produtos.ts`, `nucleo/rotas.ts` (produtos)
- Test: `apps/server/test/governanca/setores.test.ts`

**Interfaces:**
- Produces:
  - `type Setor = "hospedagem" | "recepcao" | "frigobar" | "bar" | "restaurante"` e `SETORES: Setor[]` em `apps/server/src/governanca/setores.ts`.
  - Migração: `lancamentos.setor TEXT NOT NULL DEFAULT 'recepcao'`; backfill `hospedagem` para `tipo = 'diaria'` e para lançamentos cujo produto é `EARLY_CHECKIN`/`LATE_CHECKOUT` (e seus estornos herdam o setor do original); tabela `produto_setores(produto_id, setor, PRIMARY KEY(produto_id, setor))`.
  - `lancar(ctx, d: NovoLancamento & { setor: Setor }, ator)` — `setor` obrigatório; estorno copia o setor do original. Diárias (`virada.ts`) e taxas early/late (`checkin.ts`, `checkout.ts`) passam `hospedagem`.
  - `LinhaExtrato.setor: Setor | null` (pagamentos → `null`).
  - `Produto.setores: Setor[]`; `criarProduto` aceita `setores` (padrão `["recepcao"]`); `listarProdutos(ctx, setor?: Setor)` filtra.
  - Rotas: `POST /api/contas/:id/lancamentos` aceita `setor` (padrão `recepcao`, validado em `SETORES`); `GET /api/produtos?setor=` filtra; `POST /api/produtos` aceita `setores`.

- [ ] **Step 1: Testes que falham**

```ts
test("migração preenche setor dos lançamentos existentes", async () => {
  // banco migrado até 0440, insere diária, extra EARLY_CHECKIN e extra comum; roda 0500
  // → setores ["hospedagem", "hospedagem", "recepcao"]
});
test("diária lançada pela virada vai para hospedagem; extra da recepção respeita o setor enviado", async () => {});
test("estorno herda o setor do lançamento original", async () => {});
test("extrato traz setor nos lançamentos e null nos pagamentos", async () => {});
test("produto em vários setores aparece no filtro de cada um", async () => {
  // Água mineral setores [frigobar, recepcao, bar] → GET /api/produtos?setor=frigobar contém; ?setor=restaurante não contém
});
test("setor inválido no lançamento → 400", async () => {});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run test/governanca/setores.test.ts` (em `apps/server`) → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces.
- [ ] **Step 4: Rodar** a suíte do servidor + typecheck → PASS.
- [ ] **Step 5: Commit** — `feat(server): setor nos lançamentos e produtos em vários setores`

---

### Task 2: Servidor — modelos de checklist, opção de frigobar e transição sujo → bloqueado

**Files:**
- Create: `apps/server/src/governanca/modelos.ts`, `apps/server/src/governanca/rotas.ts` (registrado em `http/app.ts`)
- Modify: `apps/server/src/governanca/migracao.ts` (nova migração `0510_governanca_modelos`), `nucleo/pousada.ts`, `nucleo/rotas.ts` (zod de `PUT /api/config`), `nucleo/quartos.ts:13`
- Test: `apps/server/test/governanca/modelos.test.ts`

**Interfaces:**
- Produces:
  - Tabelas `checklist_modelos(id, tipo UNIQUE)` e `checklist_itens(id, modelo_id, etapa, texto, ordem, ativo)`, com seeds exatamente da spec §2.1 (Saída: 6 limpeza, 4 enxoval, 4 equipamentos, 2 controles; Diária: 4 limpeza, 4 enxoval, 2 controles).
  - `type Etapa = "limpeza" | "enxoval" | "equipamento" | "controles"`; `type ItemChecklist = { id; etapa: Etapa; texto; ordem }`.
  - `obterModelos(ctx): Promise<{ saida: ItemChecklist[]; diaria: ItemChecklist[]; produtosFrigobar: Produto[]; camareiraLancaFrigobar: boolean }>` — só itens ativos, ordenados por etapa (ordem fixa limpeza, enxoval, equipamento, controles) e `ordem`.
  - `ConfigPousada.camareiraLancaFrigobar: boolean` (padrão `false`).
  - `TRANSICOES.sujo` inclui `"bloqueado"`.
  - `GET /api/checklists/modelos` (`quartos.situacao`).

- [ ] **Step 1: Testes que falham**

```ts
test("modelos padrão da spec", async () => {
  const m = await obterModelos(ctx);
  expect(m.saida.map(i => i.etapa)).toEqual([...Array(6).fill("limpeza"), ...Array(4).fill("enxoval"), ...Array(4).fill("equipamento"), ...Array(2).fill("controles")]);
  expect(m.saida[0].texto).toBe("Banheiro limpo");
  expect(m.diaria.some(i => i.etapa === "equipamento")).toBe(false);
  expect(m.camareiraLancaFrigobar).toBe(false);
});
test("item desativado não aparece", async () => {});
test("produtos de frigobar = produtos com setor frigobar", async () => {});
test("sujo → bloqueado é permitido", async () => {});
test("GET /api/checklists/modelos: governança 200, sem sessão 401", async () => {});
test("PUT /api/config aceita camareiraLancaFrigobar só para quem tem config.gerenciar", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS (suíte do servidor + typecheck).
- [ ] **Step 5: Commit** — `feat(server): modelos de checklist e opção de frigobar`

---

### Task 3: Servidor — chamados, avisos de controle e liberação

**Files:**
- Create: `apps/server/src/governanca/chamados.ts`
- Modify: `apps/server/src/governanca/migracao.ts` (`0520_governanca_chamados`), `governanca/rotas.ts`, `hospedagem/governanca.ts` (`liberar`, `marcarLimpo`), `hospedagem/rotas.ts` (rota `/limpo`)
- Test: `apps/server/test/governanca/chamados.test.ts`

**Interfaces:**
- Produces:
  - Tabela `chamados` conforme spec §6.
  - `type Chamado = { id; quartoId; quartoNumero; itemId: string | null; tipo: "defeito" | "reposicao"; descricao; observacao: string | null; situacao: "aberto" | "resolvido" | "cancelado"; abertoPor; abertoPorNome; abertoEm; encerradoPor: string | null; encerradoEm: string | null; observacaoEncerramento: string | null }`
  - `abrirChamado(tx, { quartoId, itemId, observacao? }, usuario): Promise<Chamado>` — tipo pela etapa do item (`equipamento` → defeito com descrição "<texto> não funciona"; `controles` → reposição com "<texto> faltando"); outra etapa → `ITEM_SEM_CHAMADO`.
  - `cancelarChamado(ctx, id, usuario)` — só quem abriu e só `aberto` (`CHAMADO_NAO_CANCELAVEL`).
  - `resolverChamado(ctx, id, observacao, usuario): Promise<{ podeLiberar: boolean }>` — `podeLiberar` quando o quarto está `bloqueado`/`em_manutencao` e não restam defeitos abertos.
  - `listarChamados(ctx, { situacao?, quartoId? })`; `defeitosAbertos(tx, quartoId): Promise<number>`.
  - `avisarControleFaltando(tx, { quartoId, itemId }, usuario): Promise<string>` — `criarAlerta({ tipo: "controle_faltando", alvoTipo: "reserva", alvoId: <reserva hospedada>, mensagem: "<texto> não encontrado no <numero> — conferir com o hóspede" })`; sem reserva hospedada → `QUARTO_NAO_OCUPADO`.
  - `liberar` passa a recusar com `CHAMADO_ABERTO` ("Há N chamado(s) de defeito aberto(s) neste quarto.") quando `defeitosAbertos > 0`.
  - `POST /api/quartos/:id/limpo` → 422 `CHECKLIST_OBRIGATORIO`.
  - Rotas: `POST /api/quartos/:id/chamados` `{ itemId, observacao? }` (`quartos.situacao`); `POST /api/chamados/:id/cancelar` (`quartos.situacao`); `POST /api/chamados/:id/resolver` `{ observacao? }` (`quartos.manutencao`); `GET /api/chamados?situacao=&quartoId=` (`quartos.manutencao`); `POST /api/quartos/:id/avisos-controle` `{ itemId }` (`quartos.situacao`). Eventos `governanca.ChamadoAberto|ChamadoResolvido|ChamadoCancelado`; auditoria.

- [ ] **Step 1: Testes que falham**

```ts
test("equipamento abre defeito; controle abre reposição", async () => {
  expect((await abrir(itemAr)).tipo).toBe("defeito");
  expect((await abrir(itemAr)).descricao).toBe("Ar-condicionado não funciona");
  expect((await abrir(itemControleTv)).tipo).toBe("reposicao");
});
test("liberar quarto bloqueado com defeito aberto → CHAMADO_ABERTO; com só reposição aberta → libera", async () => {});
test("resolver o último defeito de um quarto bloqueado devolve podeLiberar true", async () => {});
test("só quem abriu cancela, e só enquanto aberto", async () => {});
test("aviso de controle faltando vira alerta da reserva hospedada", async () => {});
test("rota antiga /limpo responde CHECKLIST_OBRIGATORIO", async () => {});
test("governança não resolve chamado (403); recepção resolve", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(server): chamados, avisos de controle e liberação condicionada`

---

### Task 4: Servidor — conclusão do checklist (saída e diária) e frigobar

**Files:**
- Create: `apps/server/src/governanca/checklists.ts`, `apps/server/src/governanca/frigobar.ts`
- Modify: `apps/server/src/governanca/migracao.ts` (`0530_governanca_execucoes`), `governanca/rotas.ts`
- Test: `apps/server/test/governanca/checklists.test.ts`

**Interfaces:**
- Consumes: `obterModelos` (Task 2), `abrirChamado`, `avisarControleFaltando`, `defeitosAbertos` (Task 3), `lancar` com setor (Task 1), `mudarSituacaoQuarto`.
- Produces:
  - Tabelas `checklist_execucoes`, `checklist_respostas`, `frigobar_movimentos` conforme spec §6.
  - `type RespostaEnviada = { itemId; simNao?: boolean; quantidade?: number; equipamento?: "funciona" | "nao_funciona" | "nao_se_aplica"; presenca?: "presente" | "faltando" | "nao_se_aplica"; observacao?: string; chamadoId?: string; alertaId?: string }`
  - `concluirChecklist(ctx, quartoId, d: { tipo: "saida" | "diaria"; iniciadoEm: string; respostas: RespostaEnviada[]; frigobar?: { produtoId; quantidade }[]; resultado?: "liberado" | "bloqueado"; motivo?: string }, usuario): Promise<{ execucaoId; totalFrigobar: number }>` — uma transação; regras da spec §3.1/§3.2; para `nao_funciona`/`faltando` sem `chamadoId`/`alertaId` cria agora; frigobar: diária + opção ligada → `lancar` (setor `frigobar`, origem "governanca", produto, quantidade, conta da reserva) + movimento `consumo` com `lancamento_id` e movimento `reposicao`; saída → só `reposicao`; diária com opção desligada e `frigobar` não vazio → `FRIGOBAR_DESLIGADO`; produto sem setor frigobar → `PRODUTO_NAO_FRIGOBAR`. Erros da spec §5 (`QUARTO_NAO_SUJO`, `QUARTO_NAO_OCUPADO`, `RESPOSTA_FALTANDO`, `LIMPEZA_INCOMPLETA`, `CHAMADO_ABERTO`, `MOTIVO_OBRIGATORIO`, `CONTA_FECHADA`). Quantidades: inteiros 0–999. Evento `governanca.ChecklistConcluido { execucaoId, quartoId, tipo, resultado }`; auditoria `checklist.concluir`.
  - `lancarFrigobar(ctx, contaId, { reservaId, itens: { produtoId; quantidade }[] }, usuario)` — formulário rápido do check-out: um `lancar` por item > 0 com setor `frigobar`, mesma transação; sem itens > 0 → `NADA_A_LANCAR`.
  - Rotas: `POST /api/quartos/:id/checklists` (`quartos.situacao`); `POST /api/contas/:id/frigobar` (`conta.lancar`).

- [ ] **Step 1: Testes que falham**

```ts
test("saída liberada: quarto livre, respostas com texto copiado", async () => {});
test("saída com limpeza 'Não' → LIMPEZA_INCOMPLETA para liberado; bloqueado com motivo funciona", async () => {});
test("saída liberada com defeito aberto → CHAMADO_ABERTO; com só reposição → libera", async () => {});
test("bloqueado sem motivo → MOTIVO_OBRIGATORIO; com motivo: sujo → bloqueado e motivo auditado", async () => {});
test("resposta faltando → RESPOSTA_FALTANDO", async () => {});
test("defeito marcado offline (sem chamadoId) é criado na conclusão", async () => {});
test("Review Focus 2: duas conclusões de saída do mesmo quarto — a segunda recebe QUARTO_NAO_SUJO e só há uma execução", async () => {
  const [a, b] = await Promise.allSettled([concluir(), concluir()]);
  // exatamente uma fulfilled; a outra QUARTO_NAO_SUJO; 1 linha em checklist_execucoes
});
test("diária: só com hospedada; lança frigobar na conta com setor frigobar quando a opção está ligada", async () => {
  // 1 Água (600) → extrato com linha setor frigobar 600; frigobar_movimentos consumo 1 + reposicao 1; totalFrigobar 600
});
test("diária com opção desligada e frigobar → FRIGOBAR_DESLIGADO", async () => {});
test("saída registra só reposição, sem lançamento na conta", async () => {});
test("Review Focus 3: hóspede saiu antes da conclusão da arrumação → QUARTO_NAO_OCUPADO e nada gravado", async () => {});
test("formulário rápido do check-out lança cada item com setor frigobar", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(server): conclusão do checklist e frigobar`

---

### Task 5: Servidor — governança, painel, reserva e demonstração

**Files:**
- Modify: `apps/server/src/hospedagem/governanca.ts` (`listaGovernanca`), `hospedagem/consultas.ts` (painel), `hospedagem/reservas.ts` (`obterReserva`), `apps/server/src/demo.ts`
- Test: `apps/server/test/governanca/consultas.test.ts`, `apps/server/test/demo.test.ts`

**Interfaces:**
- Produces:
  - `ItemGovernanca` ganha `tarefa: "limpeza_saida" | "arrumacao" | null`, `arrumadoHojeEm: string | null` (ISO da última diária no dia hoteleiro), `motivoBloqueio: string | null`, `chamadosAbertos: number`; ordem: limpeza_saida, arrumacao, bloqueados, demais (número crescente dentro de cada grupo).
  - Painel: `chamadosAbertos: Chamado[]` (abertos, mais antigos primeiro), `numeros.ocupadosSemArrumacao: number`, `numeros.defeitosAbertos: number`.
  - `ReservaDetalhe.ultimaArrumacao: { em: string; por: string } | null` (por = nome do usuário).
  - Demonstração conforme spec §7 (produtos com setores, opção ligada, quarto bloqueado por ar-condicionado com chamado de defeito, chamado de reposição "Controle da TV faltando", checklist de saída de ontem, duas arrumações de hoje, uma com 1 Água lançada).

- [ ] **Step 1: Testes que falham**

```ts
test("lista de governança com tarefas e ordem", async () => {
  // sujo 103, ocupado 105 sem arrumação, ocupado 104 arrumado hoje, bloqueado 201 com 1 defeito
  // → ordem [103, 105, 201, 104] com tarefas ["limpeza_saida", "arrumacao", null, null];
  //   201.motivoBloqueio === "Ar-condicionado não funciona", 201.chamadosAbertos === 1; 104.arrumadoHojeEm !== null
});
test("painel traz chamados abertos e ocupados sem arrumação", async () => {});
test("reserva mostra a última arrumação de hoje", async () => {});
test("demonstração cria chamados, frigobar e arrumações", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(server): governança, painel e demonstração com checklist`

---

### Task 6: Web — setor na conta e formulário rápido de frigobar

**Files:**
- Create: `apps/web/src/lib/setores.ts`, `apps/web/src/telas/reserva/FormFrigobar.tsx`
- Modify: `apps/web/src/telas/reserva/FormLancarExtra.tsx`, `AbaConta.tsx`, `apps/web/src/api/consultas.ts` (`useProdutos(setor?)`)
- Test: `apps/web/test/telas/conta.test.tsx`, `apps/web/test/telas/frigobar.test.tsx`

**Interfaces:**
- Produces:
  - `ROTULO_SETOR: Record<Setor, string>` (Hospedagem, Recepção, Frigobar, Bar, Restaurante).
  - Extra: campo "Setor" (Recepção, Frigobar, Bar, Restaurante; padrão Recepção); produtos de `GET /api/produtos?setor=`; envia `setor`.
  - Extrato: coluna "Setor" (rótulo, vazio para pagamentos).
  - Botão "Frigobar" na aba Conta (só reserva `hospedada`) abre `Janela` "Frigobar" com os produtos de `?setor=frigobar`: nome, preço, botões 0 · 1 · 2 · 3 · + (o "+" abre campo numérico), total em reais; "Lançar" → `POST /api/contas/:id/frigobar` `{ reservaId, itens }` só com quantidades > 0; desabilitado com total 0.

- [ ] **Step 1: Testes que falham**

```tsx
test("lançar extra envia o setor escolhido e filtra produtos pelo setor", async () => {});
test("extrato mostra a coluna Setor", async () => { expect(screen.getByRole("columnheader", { name: "Setor" })).toBeInTheDocument(); });
test("frigobar: 2 águas + 1 chocolate → total R$ 21,00 e corpo com só os itens > 0", async () => {
  // corpo { reservaId: "r1", itens: [{ produtoId: "agua", quantidade: 2 }, { produtoId: "choc", quantidade: 1 }] }
});
test("botão Frigobar só aparece para hospedada", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS (`npm test -w apps/web` + typecheck).
- [ ] **Step 5: Commit** — `feat(web): setor nos lançamentos e frigobar no painel da reserva`

---

### Task 7: Web — fluxo do checklist por etapas

**Files:**
- Create: `apps/web/src/telas/governanca/checklist/{FluxoChecklist.tsx,EtapaSimNao.tsx,EtapaContagem.tsx,EtapaEquipamentos.tsx,EtapaControles.tsx,EtapaFrigobar.tsx,EtapaResultado.tsx,rascunho.ts,checklist.css}`
- Test: `apps/web/test/telas/checklist.test.tsx`

**Interfaces:**
- Consumes: `GET /api/checklists/modelos`, `POST /api/quartos/:id/chamados`, `POST /api/chamados/:id/cancelar`, `POST /api/quartos/:id/avisos-controle`, `POST /api/alertas/:id/resolver`, `POST /api/quartos/:id/checklists`, `useConexao`.
- Produces:
  - `FluxoChecklist({ quarto: { id; numero }; tipo: "saida" | "diaria"; aoConcluir(): void; aoSair(): void })`.
  - Etapas na ordem limpeza, enxoval, equipamento, controles, frigobar (só saída, ou diária com a opção ligada), resultado (só saída); etapas sem itens são puladas. Título da etapa: "Limpeza", "Enxoval recolhido", "Equipamentos", "Controles", "Consumo do hóspede" (diária) / "Reposição do frigobar" (saída), "Resultado". Botões "Voltar", "Próxima etapa" (desabilitado até todos os itens da etapa respondidos), "Concluir".
  - Contagem: botões 0 · 1 · 2 · 3 · 4 · + (+ abre `input type=number` "Quantidade"); valores > 20 pedem confirmação "Confirmar N unidades?" antes de aceitar (Review Focus 5).
  - Equipamento "Não funciona": campo "O que aconteceu?" e `POST /chamados` imediato (online) → "Chamado aberto"; voltar para outra resposta pergunta "Cancelar o chamado aberto?" e chama `/cancelar`. Controles "Faltando": saída → chamado de reposição; diária → `avisos-controle` ("Recepção avisada"); desmarcar cancela/resolve. Offline: "Será registrado ao concluir" sem chamada.
  - Resultado: "Liberado" desabilitado com texto "Há itens de limpeza marcados como Não" ou "Há chamado de defeito aberto"; "Bloqueado" com "Motivo" pré-preenchido com os textos "<item> não funciona" separados por "; ".
  - Resumo antes de concluir (inclui "Lançado na conta: R$ X" quando houver frigobar).
  - `rascunho.ts`: `salvarRascunho(quartoId, tipo, estado)`, `lerRascunho(quartoId, tipo)`, `apagarRascunho(quartoId, tipo)` em `localStorage` (chave `erp.checklist.<quartoId>.<tipo>`, com `situacaoQuarto` e `salvoEm`); ao abrir, rascunho com `situacaoQuarto` diferente da atual é descartado com "O quarto mudou de situação; o checklist foi reiniciado." (Review Focus 4).
  - Erro na conclusão (ex.: `QUARTO_NAO_OCUPADO`, `CONTA_FECHADA`): mantém respostas e rascunho, mostra `ErroAcao`.

- [ ] **Step 1: Testes que falham**

```tsx
test("percorre as etapas da saída e conclui liberado", async () => { /* corpo POST com respostas de todos os itens e resultado liberado */ });
test("Liberado desabilitado com limpeza 'Não' e motivo sugerido no bloqueio", async () => {});
test("Review Focus 1: alternar Não funciona / Funciona três vezes deixa só um chamado aberto", async () => {
  // POST /chamados x3, POST /cancelar x2 (ou x3 terminando em Funciona), estado final coerente
});
test("controle faltando na diária avisa a recepção", async () => {});
test("Review Focus 5: quantidade 50 pede confirmação", async () => {});
test("rascunho salvo e retomado; descartado se o quarto mudou de situação", async () => {});
test("Review Focus 3: QUARTO_NAO_OCUPADO na conclusão mantém respostas e mostra a mensagem", async () => {});
test("offline: chamado vira pendente e Concluir fica desabilitado", async () => {});
test("frigobar aparece na diária só com a opção ligada", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): checklist do apartamento por etapas`

---

### Task 8: Web — tela Governança com tarefas

**Files:**
- Modify: `apps/web/src/telas/governanca/TelaGovernanca.tsx`, `governanca.css`
- Test: `apps/web/test/telas/governanca.test.tsx`

**Interfaces:**
- Consumes: `GET /api/governanca` ampliado (Task 5), `FluxoChecklist` (Task 7).
- Produces:
  - Cartões com a tarefa: "Limpeza de saída" (sujo), "Arrumação" (ocupado sem arrumação), "Arrumado às HH:MM" (ocupado arrumado; toque abre nova arrumação), "Bloqueado: <motivo> · N chamado(s)" (bloqueado), demais sem ação.
  - Tocar num sujo abre o `FluxoChecklist` tipo `saida`; num ocupado, tipo `diaria`; a lista some enquanto o fluxo está aberto (tela cheia no celular) e volta ao concluir/sair.
  - Remove a confirmação "Marcar como limpo"; menu ⋯ continua para quem tem `quartos.manutencao`, e "Liberar" mostra a mensagem `CHAMADO_ABERTO` quando houver.

- [ ] **Step 1: Testes que falham**

```tsx
test("cartões mostram a tarefa de cada quarto", async () => {});
test("tocar no sujo abre a limpeza de saída; no ocupado, a arrumação", async () => {});
test("não existe mais 'Marcar como limpo'", async () => { expect(screen.queryByText(/marcar .* como limpo/i)).toBeNull(); });
test("liberar com defeito aberto mostra CHAMADO_ABERTO", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): governança com tarefas e checklist`

---

### Task 9: Web — chamados na tela Hoje, mapa e painel da reserva

**Files:**
- Create: `apps/web/src/telas/hoje/BlocoChamados.tsx`
- Modify: `apps/web/src/telas/hoje/{TelaHoje.tsx,BlocoGovernanca.tsx}`, `apps/web/src/layout/MenuLateral.tsx` (contador), `apps/web/src/telas/mapa/GradeMapa.tsx` (bloqueado), `apps/web/src/telas/reserva/AbaResumo.tsx`
- Test: `apps/web/test/telas/hoje.test.tsx`, `apps/web/test/telas/reserva.test.tsx`, `apps/web/test/telas/mapa.test.tsx`

**Interfaces:**
- Consumes: painel ampliado e `ultimaArrumacao` (Task 5), `POST /api/chamados/:id/resolver`, `POST /api/quartos/:id/liberar`.
- Produces:
  - `BlocoChamados`: título "Chamados abertos (N)"; linha "<Defeito|Reposição> · Qto <numero> · <descricao>", observação, "por <nome> há <tempo>"; botão "Resolvido" abre `Janela` com "Observação (opcional)" → resolver; se `podeLiberar`, a linha vira "Liberar quarto" (pede motivo "Liberado após resolução do chamado" pré-preenchido) → `POST /liberar`. Some quando vazio. Só para `quartos.manutencao`.
  - `BlocoGovernanca`: inclui bloqueados com motivo e "N ocupado(s) sem arrumação hoje".
  - Contador do menu Hoje = `atencao.length + numeros.defeitosAbertos`.
  - Mapa: rótulo do quarto bloqueado mostra "bloqueado · N chamado(s)" quando houver.
  - Resumo da reserva: "Última arrumação: hoje às HH:MM por <nome>" ou "Sem arrumação hoje" (só `hospedada`).

- [ ] **Step 1: Testes que falham**

```tsx
test("chamados abertos com Resolvido e depois Liberar quarto", async () => {});
test("contador do menu soma atenção e defeitos abertos", async () => {});
test("resumo mostra a última arrumação", async () => {});
test("mapa mostra o nº de chamados do quarto bloqueado", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): chamados na tela Hoje e arrumação no painel`

---

### Task 10: Ponta a ponta no navegador

**Files:**
- Create: `apps/web/e2e/governanca.spec.ts`
- Modify: `apps/web/playwright.config.ts` (incluir o spec nos projetos certos), `apps/web/e2e/preparar.ts` se necessário

**Interfaces:**
- Consumes: demonstração (Task 5), todas as telas acima.

- [ ] **Step 1: Escrever o roteiro e ver falhar** — `npm run e2e` → FAIL:
  1. (celular) `governanca`/`governanca123` → Governança → quarto ocupado da demonstração → Arrumação: limpeza toda Sim, enxoval 1/1/0/0, controles presentes, frigobar 1 Água → Concluir → cartão mostra "Arrumado às".
  2. (desktop) `recepcao` → painel da reserva desse quarto → aba Conta mostra "Água mineral" com setor Frigobar e R$ 6,00.
  3. (celular) governança → um quarto sujo → limpeza Sim, enxoval, Ar-condicionado "Não funciona" ("Chamado aberto"), controles presentes, reposição 0 → Resultado: Liberado desabilitado, Bloqueado com motivo sugerido "Ar-condicionado não funciona" → Concluir.
  4. (desktop) recepção → Hoje → "Chamados abertos" mostra o defeito → Resolvido → Liberar quarto → mapa mostra o quarto livre.
- [ ] **Step 2: Ajustar** o que o roteiro revelar.
- [ ] **Step 3: Rodar** — `npm run e2e` → PASS em todos os projetos; suítes unitárias e typechecks → PASS.
- [ ] **Step 4: Commit** — `test(e2e): governança com checklist, chamado e frigobar`
