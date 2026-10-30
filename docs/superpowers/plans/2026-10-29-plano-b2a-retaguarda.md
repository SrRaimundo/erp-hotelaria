# Plano B2a — Retaguarda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assistente de primeira configuração e telas de retaguarda (pousada, categorias e quartos, usuários, perfis, produtos, checklists), com o servidor ganhando edição, desativação e as proteções da spec.

**Architecture:** No servidor, cada cadastro ganha coluna `ativo`, rotas de edição/desativação/reativação e filtros de "só ativos" nas consultas de uso; usuários e perfis ganham gestão completa com guardas contra travar o sistema; um módulo `retaguarda/` hospeda o assistente. Na interface, uma área `/configuracoes` com submenu e um padrão reutilizável de "lista + painel lateral de edição".

**Tech Stack:** o mesmo dos planos anteriores (Fastify 5, Kysely + SQLite, zod, Vitest; React 19, React Router 7, TanStack Query 5, Testing Library, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-29-plano-b2a-retaguarda-design.md` (bases: specs do Plano A, B1 e governança).

## Global Constraints

- Branch `plano-b2a-retaguarda`; migrações na faixa `0600_retaguarda*`; colunas novas `ativo INTEGER NOT NULL DEFAULT 1`.
- Desativar em vez de apagar (exceção: perfil personalizado sem usuários pode ser excluído). Toda criação/edição/desativação/reativação auditada.
- Permissões: assistente, pousada, usuários, perfis, checklists → `config.gerenciar`; categorias, quartos, produtos → `cadastros.gerenciar`.
- Códigos de erro da spec: `CATEGORIA_COM_QUARTOS`, `QUARTO_COM_RESERVAS`, `USUARIO_DESATIVADO`, `OPERACAO_SOBRE_SI`, `ULTIMO_ADMINISTRADOR`, `PERFIL_COM_USUARIOS`, `PERFIL_ADMIN_PROTEGIDO`, `NUMERO_QUARTO_DUPLICADO`.
- Descrições das permissões: exatamente a tabela da spec §5.4.
- Regras de interface do B1 valem (tokens, pt-BR, mensagens da API junto da ação, painel lateral = `Gaveta`).
- Não usar a porta 8080 (servidor de demonstração do dono do produto).

## Review Focus

1. **Administrador remove `config.gerenciar` do perfil personalizado que ele mesmo usa, e ele é o único com essa permissão** → recusado com `ULTIMO_ADMINISTRADOR`. (Teste na Task 3.)
2. **Faixa de quartos que colide com números existentes** (ex.: 101–106 com 105 já cadastrado, ativo ou inativo) → nada é criado e a mensagem lista os números em conflito. (Testes nas Tasks 1 e 5.)
3. **Reativar um quarto cujo número foi reaproveitado por outro quarto ativo** → `NUMERO_QUARTO_DUPLICADO`. (Teste na Task 1.)
4. **Redefinir a senha de um usuário logado** → as sessões dele são encerradas. (Teste na Task 2.)
5. **Reabrir o assistente depois de concluir o passo de quartos** → mostra o que já existe e não duplica categorias nem quartos. (Testes nas Tasks 5 e 10.)

---

## Estrutura de arquivos

```
apps/server/src/
  retaguarda/  migracao.ts  assistente.ts  rotas.ts
  nucleo/      categorias.ts quartos.ts produtos.ts usuarios.ts sessoes.ts permissoes.ts perfis.ts rotas.ts
  hospedagem/  disponibilidade.ts consultas.ts governanca.ts checkin.ts   (filtros de ativos)
  tarifas/     ocupacao.ts                                               (filtro de ativos)
  governanca/  modelos.ts checklists.ts rotas.ts                          (admin de itens, itensExibidos)
apps/web/src/
  telas/configuracoes/  LayoutConfiguracoes.tsx ListaCadastro.tsx TelaPousada.tsx TelaCategoriasQuartos.tsx TelaUsuarios.tsx TelaPerfis.tsx TelaProdutos.tsx TelaChecklists.tsx configuracoes.css
  telas/assistente/     Assistente.tsx PassoPousada.tsx PassoQuartos.tsx PassoEquipe.tsx PassoPronto.tsx
apps/web/e2e/implantacao.spec.ts
```

---

### Task 1: Servidor — edição e desativação de categorias, quartos e produtos

**Files:**
- Create: `apps/server/src/retaguarda/migracao.ts` (`0600_retaguarda_ativos`), register in `src/shared/migracoes.ts`
- Modify: `nucleo/{categorias,quartos,produtos,rotas}.ts`, `hospedagem/{disponibilidade,consultas,governanca,checkin}.ts`, `tarifas/ocupacao.ts`, `governanca/modelos.ts` (produtos de frigobar)
- Test: `apps/server/test/retaguarda/cadastros.test.ts`

**Interfaces:**
- Produces:
  - Colunas `ativo` em `categorias`, `quartos`, `produtos`.
  - `editarCategoria(ctx, id, { nome; maxAdultos; maxCriancas; comodidades }, ator)`, `definirCategoriaAtiva(ctx, id, ativa: boolean, ator)` — desativar com quarto ativo → `CATEGORIA_COM_QUARTOS`.
  - `editarQuarto(ctx, id, { numero; categoriaId; bloco }, ator)`, `definirQuartoAtivo(ctx, id, ativo, ator)` — desativar com reserva ativa atribuída e saída ≥ dia hoteleiro, ou situação `ocupado` → `QUARTO_COM_RESERVAS` (`detalhes.codigos`); reativar com número igual a outro quarto ativo → `NUMERO_QUARTO_DUPLICADO`. Número continua único entre ativos; ao editar, idem.
  - `criarQuartosEmLote(tx, { categoriaId; de: number; ate: number; bloco? }, ator): Promise<Quarto[]>` — números `de..ate` como texto; qualquer número já existente (ativo ou inativo) → `NUMERO_QUARTO_DUPLICADO` com `detalhes.numeros` e nada criado; máximo 200 por lote.
  - `editarProduto(ctx, id, { nome; precoCentavos; unidade; tipo; setores }, ator)`, `definirProdutoAtivo(ctx, id, ativo, ator)`; `listarProdutos(ctx, setor?, { incluirInativos? })` exclui `EARLY_CHECKIN`/`LATE_CHECKOUT` quando `setor` não é `hospedagem` e exclui inativos por padrão.
  - `listarCategorias`/`listarQuartos` aceitam `{ incluirInativos? }` (padrão só ativos).
  - Filtros "só ativos": disponibilidade/categoria lotada, ocupação, mapa, governança, sugestões de check-in, produtos de frigobar.
  - Rotas: `PUT /api/categorias/:id`, `POST /api/categorias/:id/{desativar,reativar}`, `PUT /api/quartos/:id`, `POST /api/quartos/:id/{desativar,reativar}`, `POST /api/quartos/lote`, `PUT /api/produtos/:id`, `POST /api/produtos/:id/{desativar,reativar}`; `GET` das três listas aceita `?incluirInativos=1` (exige `cadastros.gerenciar` quando presente). Todas as escritas exigem `cadastros.gerenciar`.

- [ ] **Step 1: Testes que falham**

```ts
test("desativar categoria com quarto ativo → CATEGORIA_COM_QUARTOS", async () => {});
test("desativar quarto com reserva futura → QUARTO_COM_RESERVAS com os códigos", async () => {});
test("quarto inativo some do mapa, da disponibilidade, da governança e das sugestões", async () => {});
test("Review Focus 3: reativar quarto com número reaproveitado → NUMERO_QUARTO_DUPLICADO", async () => {});
test("Review Focus 2: lote 101–106 com 105 existente → nada criado e detalhes.numeros = ['105']", async () => {});
test("produto inativo some do lançamento e do frigobar; EARLY/LATE fora da lista", async () => {});
test("governança não edita cadastros (403)", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS (suíte do servidor + typecheck).
- [ ] **Step 5: Commit** — `feat(server): editar e desativar categorias, quartos e produtos`

---

### Task 2: Servidor — gestão de usuários

**Files:**
- Modify: `apps/server/src/retaguarda/migracao.ts` (`0610_retaguarda_usuarios`), `nucleo/{usuarios,sessoes,rotas}.ts`
- Test: `apps/server/test/retaguarda/usuarios.test.ts`

**Interfaces:**
- Produces:
  - Colunas `usuarios.ativo`, `usuarios.ultimo_acesso` (atualizado no login).
  - `listarUsuarios(ctx): Promise<{ id; nome; login; perfil; perfilRotulo; ativo; ultimoAcesso: string | null; trocarSenha }[]>`.
  - `editarUsuario(ctx, id, { nome; perfil }, autor: UsuarioSessao)`, `definirUsuarioAtivo(ctx, id, ativo, autor)`, `redefinirSenha(ctx, id, autor): Promise<{ senhaTemporaria: string }>` — 8 caracteres (letras e dígitos sem ambíguos 0/O/1/l), `trocar_senha = 1`, encerra sessões.
  - Guardas: autor sobre si mesmo em desativar/mudar perfil → `OPERACAO_SOBRE_SI`; deixaria zero usuários ativos com `config.gerenciar` → `ULTIMO_ADMINISTRADOR`.
  - Desativar encerra todas as sessões; `entrar` com usuário inativo → `USUARIO_DESATIVADO`; `sessaoPorToken` de inativo → sem sessão.
  - Rotas (`config.gerenciar`): `GET /api/usuarios`, `PUT /api/usuarios/:id`, `POST /api/usuarios/:id/{desativar,reativar,redefinir-senha}`.

- [ ] **Step 1: Testes que falham**

```ts
test("desativar encerra sessões e impede login", async () => {});
test("Review Focus 4: redefinir senha encerra as sessões e devolve senha de 8 caracteres", async () => {
  // r.senhaTemporaria.length === 8; sessão antiga → 401; login com a temporária → trocarSenha true
});
test("não desativa a si mesmo nem muda o próprio perfil", async () => {});
test("não desativa o último administrador ativo", async () => {});
test("lista traz último acesso após login", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(server): gestão de usuários`

---

### Task 3: Servidor — perfis personalizados

**Files:**
- Create: `apps/server/src/nucleo/perfis.ts`
- Modify: `apps/server/src/retaguarda/migracao.ts` (`0620_retaguarda_perfis`), `nucleo/{permissoes,sessoes,rotas}.ts`
- Test: `apps/server/test/retaguarda/perfis.test.ts`

**Interfaces:**
- Produces:
  - Colunas `perfis.rotulo` (seed: Administrador, Recepção, Governança) e `perfis.padrao` (1 nos três).
  - `DESCRICOES_PERMISSOES: Record<Permissao, string>` — exatamente a tabela da spec §5.4; `GET /api/permissoes` → `{ permissao; descricao }[]`.
  - `listarPerfis(ctx) → { nome; rotulo; padrao; limiteDesconto; permissoes; usuarios: number }[]`.
  - `criarPerfil(ctx, { rotulo; copiarDe: string }, autor)` — `nome` = slug do rótulo (minúsculas, sem acento, `-`), sufixo `-2`, `-3` se existir; copia permissões e limite.
  - `editarPerfil(ctx, nome, { rotulo?; limiteDesconto?; permissoes? }, autor)` — `admin` sem `config.gerenciar` → `PERFIL_ADMIN_PROTEGIDO`; resultado que deixa zero usuários ativos com `config.gerenciar` → `ULTIMO_ADMINISTRADOR`; permissões fora da lista → `PERMISSAO_INVALIDA`.
  - `excluirPerfil(ctx, nome, autor)` — padrão → `PERFIL_PADRAO`; com usuários → `PERFIL_COM_USUARIOS`.
  - Sessão: `sessaoPorToken` relê permissões e limite do perfil a cada requisição (sem cache).
  - Rotas (`config.gerenciar`): `GET /api/perfis`, `POST /api/perfis`, `PUT /api/perfis/:nome`, `DELETE /api/perfis/:nome`, `GET /api/permissoes` (sessão).

- [ ] **Step 1: Testes que falham**

```ts
test("criar perfil copiando de recepcao e gerar nome único", async () => {
  // rotulo "Mensageiro" → nome "mensageiro"; outro "Mensageiro" → "mensageiro-2"
});
test("Review Focus 1: tirar config.gerenciar do perfil do único administrador → ULTIMO_ADMINISTRADOR", async () => {});
test("admin não perde config.gerenciar (PERFIL_ADMIN_PROTEGIDO)", async () => {});
test("perfil com usuários não é excluído; padrão também não", async () => {});
test("permissão retirada vale na próxima requisição da sessão aberta", async () => {});
test("descrições das permissões conforme a spec", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(server): perfis personalizados`

---

### Task 4: Servidor — administração dos itens de checklist

**Files:**
- Modify: `apps/server/src/governanca/{modelos,checklists,rotas}.ts`
- Test: `apps/server/test/retaguarda/checklist-itens.test.ts`

**Interfaces:**
- Produces:
  - `listarItensAdmin(ctx, tipo: "saida" | "diaria"): Promise<(ItemChecklist & { ativo: boolean })[]>` (inclui inativos, ordem por etapa e `ordem`).
  - `criarItem(ctx, { tipo; etapa; texto }, ator)` — vai para o fim da etapa; `editarItem(ctx, id, { texto?; ativo? }, ator)`; `moverItem(ctx, id, direcao: "acima" | "abaixo", ator)` — troca a `ordem` com o vizinho da mesma etapa; no limite não faz nada.
  - `concluirChecklist` aceita `itensExibidos?: string[]`: com ela, exige resposta só para os itens ativos que estão na lista e ignora respostas de itens desativados; sem ela, comportamento atual.
  - Rotas (`config.gerenciar`): `GET /api/checklists/itens?tipo=`, `POST /api/checklists/itens`, `PUT /api/checklists/itens/:id`, `POST /api/checklists/itens/:id/mover`.
  - Web (mesma task, pequeno): o rascunho do `FluxoChecklist` guarda e envia `itensExibidos`.

- [ ] **Step 1: Testes que falham**

```ts
test("incluir, renomear, reordenar e desativar itens", async () => {});
test("item desativado durante o preenchimento não bloqueia a conclusão", async () => {});
test("item criado depois do início não é exigido quando itensExibidos é enviado", async () => {});
test("governança não administra itens (403)", async () => {});
```
(e um teste web: o corpo do Concluir inclui `itensExibidos`.)

- [ ] **Step 2–4:** falhar → implementar → PASS (servidor e web).
- [ ] **Step 5: Commit** — `feat: administração dos itens de checklist`

---

### Task 5: Servidor — assistente de primeira configuração

**Files:**
- Create: `apps/server/src/retaguarda/{assistente,rotas}.ts` (registrado em `http/app.ts`)
- Modify: `nucleo/pousada.ts` (`assistenteEquipePulado`)
- Test: `apps/server/test/retaguarda/assistente.test.ts`

**Interfaces:**
- Consumes: `criarQuartosEmLote` (Task 1), `salvarTabelaBase` (tarifas), `criarCategoria`.
- Produces:
  - `estadoAssistente(ctx): Promise<{ pousada: boolean; quartos: boolean; equipe: boolean; categorias: { id; nome; quartos: string[] }[] }>` — `pousada` = razão social preenchida; `quartos` = existe quarto ativo; `equipe` = existe usuário ativo além do `usuario-admin` ou `assistenteEquipePulado`.
  - `configurarQuartos(ctx, { categorias: { nome; maxAdultos; maxCriancas; porAdultos: { 1; 2; 3 }; adultoExtra; de; ate; bloco? }[] }, ator)` — uma transação: cria categorias, tabelas base e quartos; nome de categoria repetido no pedido ou já existente → `CATEGORIA_DUPLICADA`; faixas sobrepostas entre si ou com quartos existentes → `NUMERO_QUARTO_DUPLICADO` (`detalhes.numeros`); nada gravado em erro.
  - `ConfigPousada.assistenteEquipePulado: boolean` (padrão false).
  - Rotas (`config.gerenciar`): `GET /api/assistente`, `POST /api/assistente/quartos`, `POST /api/assistente/pular-equipe`.

- [ ] **Step 1: Testes que falham**

```ts
test("base vazia: nenhum passo concluído", async () => {});
test("configurar quartos cria categorias, tabela base e quartos atomicamente", async () => {});
test("Review Focus 2: faixas sobrepostas entre categorias → NUMERO_QUARTO_DUPLICADO e nada gravado", async () => {});
test("Review Focus 5: estado após quartos mostra as categorias existentes; nova chamada com a mesma categoria → CATEGORIA_DUPLICADA", async () => {});
test("pular equipe marca o passo", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(server): assistente de primeira configuração`

---

### Task 6: Web — área Configurações, padrão de lista e tela Pousada

**Files:**
- Create: `apps/web/src/telas/configuracoes/{LayoutConfiguracoes,ListaCadastro,TelaPousada}.tsx`, `configuracoes.css`
- Modify: `apps/web/src/rotas.tsx`, `layout/MenuLateral.tsx`, `api/consultas.ts`
- Test: `apps/web/test/telas/configuracoes.test.tsx`

**Interfaces:**
- Produces:
  - Rotas `/configuracoes/{pousada,categorias,usuarios,perfis,produtos,checklists}` sob `LayoutConfiguracoes` (submenu à esquerda dentro da página; no celular vira lista no topo); guardas `ExigePermissao` por tela (`config.gerenciar` ou `cadastros.gerenciar` conforme a spec §2); `/configuracoes` redireciona para a primeira permitida.
  - Item de menu "Configurações" visível com qualquer das duas permissões.
  - `ListaCadastro<T>({ titulo, itens, colunas, chave, aoNovo, aoEditar, mostrarInativos, aoMostrarInativos, renderPainel })` — tabela + "+ Novo" + checkbox "Mostrar desativados" + `Gaveta` com o painel de edição; linhas inativas esmaecidas com etiqueta "desativado".
  - `TelaPousada`: seções Dados / Horários / Regras (campos da spec §5.1) com "Salvar" por seção → `PUT /api/config`; dinheiro em `CampoDinheiro`; horários `type="time"`.

- [ ] **Step 1: Testes que falham**

```tsx
test("menu Configurações só com permissão; submenu mostra só as telas permitidas", async () => {});
test("Pousada salva a seção Regras com o corpo esperado", async () => {
  // { sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 }, ... camareiraLancaFrigobar: true }
});
test("ListaCadastro: Mostrar desativados e painel de edição", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): área de configurações e tela da pousada`

---

### Task 7: Web — categorias e quartos

**Files:**
- Create: `apps/web/src/telas/configuracoes/TelaCategoriasQuartos.tsx`
- Test: `apps/web/test/telas/categorias-quartos.test.tsx`

**Interfaces:**
- Consumes: rotas da Task 1, `GET/PUT /api/tarifas/tabelas-base` (preço base da categoria), `ListaCadastro`.
- Produces: duas listas na mesma tela (Categorias acima, Quartos abaixo com filtro por categoria). Painel da categoria: nome, capacidades, comodidades (separadas por vírgula), preço base (1/2/3 adultos, adulto extra, piso, teto) — salva categoria e tabela base. Painel do quarto: número, categoria, bloco. Botões "Desativar"/"Reativar" com a mensagem do servidor (incluindo os códigos de reservas). "Criar vários quartos": categoria, de, até, bloco → `POST /api/quartos/lote`, conflito mostra os números.

- [ ] **Step 1: Testes que falham**

```tsx
test("editar categoria salva categoria e preço base", async () => {});
test("desativar quarto com reservas mostra os códigos", async () => {});
test("criar vários quartos e conflito listando números", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): categorias e quartos na retaguarda`

---

### Task 8: Web — usuários e perfis

**Files:**
- Create: `apps/web/src/telas/configuracoes/{TelaUsuarios,TelaPerfis}.tsx`
- Test: `apps/web/test/telas/usuarios-perfis.test.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 2 e 3.
- Produces:
  - Usuários: lista (nome, login, perfil, situação, último acesso). Painel: nome, perfil (select com rótulos), senha inicial (só ao criar). Ações: Desativar/Reativar, "Redefinir senha" → `Janela` mostrando a senha temporária com aviso "Anote agora; ela não será mostrada de novo." Botões de desativar/mudar perfil ocultos para o próprio usuário.
  - Perfis: lista (rótulo, padrão, nº de usuários). "+ Novo perfil": rótulo + "Copiar permissões de". Painel: rótulo, limite de desconto (%), permissões em checkboxes com as descrições de `GET /api/permissoes`. "Excluir" só para personalizados sem usuários. Erros `ULTIMO_ADMINISTRADOR`/`PERFIL_ADMIN_PROTEGIDO` mostrados junto do Salvar.

- [ ] **Step 1: Testes que falham**

```tsx
test("redefinir senha mostra a senha temporária uma vez", async () => {});
test("não mostra desativar para o próprio usuário", async () => {});
test("criar perfil copiando permissões e marcar/desmarcar", async () => {});
test("erro ULTIMO_ADMINISTRADOR aparece junto do salvar", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): usuários e perfis na retaguarda`

---

### Task 9: Web — produtos e checklists

**Files:**
- Create: `apps/web/src/telas/configuracoes/{TelaProdutos,TelaChecklists}.tsx`
- Test: `apps/web/test/telas/produtos-checklists.test.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 1 e 4.
- Produces:
  - Produtos: lista com filtro por setor e "Mostrar desativados"; painel: código (só ao criar), nome, preço (`CampoDinheiro`), unidade, tipo, setores (checkboxes Recepção, Frigobar, Bar, Restaurante; ao menos um).
  - Checklists: abas Saída/Diária; por etapa, itens com ↑ ↓, renomear (edição inline com Salvar), Desativar/Reativar; "+ Item" por etapa.

- [ ] **Step 1: Testes que falham**

```tsx
test("produto exige ao menos um setor e salva preço em centavos", async () => {});
test("checklist: incluir, mover e desativar item", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): produtos e checklists na retaguarda`

---

### Task 10: Web — assistente de primeira configuração

**Files:**
- Create: `apps/web/src/telas/assistente/{Assistente,PassoPousada,PassoQuartos,PassoEquipe,PassoPronto}.tsx`
- Modify: `apps/web/src/rotas.tsx`, `auth/RotaProtegida.tsx` (ou equivalente) para o redirecionamento automático, `telas/configuracoes/LayoutConfiguracoes.tsx` (item "Primeira configuração")
- Test: `apps/web/test/telas/assistente.test.tsx`

**Interfaces:**
- Consumes: `GET /api/assistente`, `POST /api/assistente/quartos`, `POST /api/assistente/pular-equipe`, `PUT /api/config`, `POST /api/usuarios`.
- Produces:
  - Rota `/configuracoes/assistente`. Redirecionamento automático: usuário com `config.gerenciar`, após a troca de senha, quando `GET /api/assistente` → `quartos: false`, vai para o assistente (uma vez por sessão; "Sair do assistente" leva ao destino normal).
  - Barra de passos (1 Pousada · 2 Quartos · 3 Equipe · 4 Pronto); abre no primeiro passo incompleto.
  - Passo 2: linhas de categoria (nome, adultos, crianças, preços 1/2/3, adulto extra, de, até, bloco) com "+ Outra categoria"; se `quartos: true`, mostra as categorias/quartos existentes em modo leitura e "Avançar" (Review Focus 5); erro de numeração destaca os números.
  - Passo 3: linhas de usuário (nome, login, perfil, senha inicial) com "+ Outro"; "Pular" chama `pular-equipe`.
  - Passo 4: resumo e botões "Ir para o mapa" e "Ajustar regras da pousada".

- [ ] **Step 1: Testes que falham**

```tsx
test("admin em base vazia é levado ao assistente após a troca de senha", async () => {});
test("passo de quartos envia as categorias e avança", async () => {});
test("Review Focus 5: com quartos existentes, o passo 2 só mostra e não reenvia", async () => {});
test("pular equipe", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): assistente de primeira configuração`

---

### Task 11: Ponta a ponta — implantação de uma pousada nova

**Files:**
- Create: `apps/web/e2e/implantacao.spec.ts`
- Modify: `apps/web/e2e/preparar.ts` (opção de base vazia: segundo servidor na porta 8098 sem semear) e `playwright.config.ts`

- [ ] **Step 1: Roteiro que falha** — base vazia (porta 8098): login `admin`/`admin` → troca para `admin123` → assistente: pousada "Pousada Teste" → categoria "Standard" 2 adultos, R$ 200/250/300, quartos 1–3 → equipe: "Rita", `rita`, Recepção, senha `rita1234` → Pronto → "Ir para o mapa" mostra quartos 1, 2 e 3 → nova reserva para hoje no quarto 2 → sair → login `rita`/`rita1234` → troca de senha → tela Hoje.
- [ ] **Step 2: Ajustar** o que o roteiro revelar.
- [ ] **Step 3: Rodar** `npm run e2e` (todos os specs) + suítes unitárias + typechecks → PASS.
- [ ] **Step 4: Commit** — `test(e2e): implantação de uma pousada nova pelo assistente`
