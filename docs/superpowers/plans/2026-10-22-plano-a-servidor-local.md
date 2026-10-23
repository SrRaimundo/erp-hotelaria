# Plano A — Servidor local: Núcleo, Tarifas e Hospedagem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o servidor local (regras de negócio + API HTTP) de Núcleo, Tarifas e Hospedagem, totalmente testado, gravando todos os eventos numa fila (outbox) pronta para a sincronização.

**Architecture:** Monolito modular em TypeScript/Node.js. Cada módulo (`nucleo`, `tarifas`, `hospedagem`) é dono das suas tabelas e expõe funções de serviço que recebem um `Contexto` (banco, relógio, barramento). Toda escrita acontece numa transação que também grava o evento no outbox e, quando for o caso, a auditoria. A API HTTP (Fastify) é uma camada fina sobre os serviços.

**Tech Stack:** Node.js 24 LTS, TypeScript 5.9 (strict), Fastify 5, Kysely 0.28 + better-sqlite3 12 (SQLite; Kysely também tem dialeto MySQL para o Plano C), zod 4, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-22-nucleo-hospedagem-design.md`

**Fora deste plano (planos seguintes):** B — interface web (PWA); C — sincronização e nuvem; D — impressão, backup, serviço Windows e instalador. Este plano só **emite** os eventos que esses planos vão consumir (ex.: `hospedagem.CheckinConcluido` para impressão).

## Global Constraints

- Moeda: somente BRL. Todo valor monetário é **inteiro em centavos** (`Centavos = number`, sempre inteiro ao ser gravado).
- Datas de estadia são strings `YYYY-MM-DD` (data local da pousada). Instantes são ISO-8601 UTC. Fuso padrão `America/Sao_Paulo`.
- Nenhum código lê `Date.now()`/`new Date()` diretamente: sempre `ctx.relogio.agora()`.
- Lançamentos financeiros (lançamentos de conta, pagamentos) **nunca** são atualizados nem apagados; correção só por estorno.
- Ações automáticas são auditadas com ator `"Sistema"`.
- Ações sensíveis exigem credencial de supervisor **e** motivo: estorno, cancelamento manual de reserva, no-show, desconto acima do limite do perfil, prorrogação de sinal, alteração de preço congelado, ultrapassar restrição de data.
- SQLite sempre em `journal_mode=WAL` e `foreign_keys=ON`.
- Identificadores de domínio em português; arquivos em kebab-case.
- Mensagens de erro para o usuário em português simples, dizendo o que corrigir.

## Review Focus

1. **Duas recepções reservando o mesmo quarto/data ao mesmo tempo** → a segunda falha com `QUARTO_INDISPONIVEL`; nunca duas reservas sobrepostas no mesmo quarto. (Teste na Task 9.)
2. **Estadia que atravessa a troca de temporada ou um pacote** → cada noite é precificada pelas regras da sua própria data. (Teste na Task 8.)
3. **Servidor desligado por dias (ou virada executada duas vezes)** → a virada lança as noites faltantes uma única vez, sem duplicar. (Teste na Task 13.)
4. **Hóspede sai antes da data prevista** → paga só as noites efetivamente usadas; as noites futuras congeladas são descartadas. (Teste na Task 15.)
5. **Arrastar/esticar reserva sobre outra no mapa** → alteração rejeitada com `QUARTO_INDISPONIVEL`, reserva original intacta. (Teste na Task 10.)

---

## Estrutura de arquivos

```
package.json                      # workspaces: ["apps/*"]
apps/server/
  package.json  tsconfig.json  vitest.config.ts
  src/
    shared/      dinheiro.ts tempo.ts relogio.ts ids.ts erros.ts banco.ts migracoes.ts contexto.ts
    infra/       outbox.ts barramento.ts auditoria.ts alertas.ts migracao.ts
    nucleo/      pousada.ts categorias.ts quartos.ts hospedes.ts produtos.ts formas-pagamento.ts
                 usuarios.ts permissoes.ts sessoes.ts supervisor.ts caixa.ts migracao.ts rotas.ts
    tarifas/     tipos.ts calculo.ts criancas.ts regras.ts ocupacao.ts cotacao.ts restricoes.ts migracao.ts rotas.ts
    hospedagem/  estados.ts reservas.ts alteracao.ts disponibilidade.ts conta.ts sinal.ts virada.ts
                 checkin.ts checkout.ts governanca.ts consultas.ts migracao.ts rotas.ts
    http/        app.ts autenticacao.ts erros-http.ts
    main.ts      agendador.ts config.ts
  test/
    ajuda.ts                       # criarContextoTeste(), semear*()
    <mesma árvore de src>/*.test.ts
```

---

### Task 1: Fundação do projeto e utilitários compartilhados

**Files:**
- Create: `package.json`, `.gitignore`, `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`
- Create: `apps/server/src/shared/{dinheiro,tempo,relogio,ids,erros,banco,migracoes,contexto}.ts`
- Create: `apps/server/test/ajuda.ts`
- Test: `apps/server/test/shared/{dinheiro,tempo,banco}.test.ts`

**Interfaces:**
- Produces:
  - `type Centavos = number`; `aplicarPercentual(v: number, pct: number): number` (sem arredondar); `arredondarCentavos(v: number): Centavos` (meio para longe do zero); `arredondarReal(v: Centavos): Centavos`; `formatarBRL(v: Centavos): string`
  - `type Data = string` (YYYY-MM-DD); `somarDias(d: Data, n: number): Data`; `noites(chegada: Data, saida: Data): Data[]` (chegada inclusive, saída exclusiva); `diaDaSemana(d: Data): 0..6` (0 = domingo); `dataLocal(instante: Date, fuso: string): Data`; `horaLocal(instante: Date, fuso: string): string` ("HH:MM"); `diaHoteleiro(instante: Date, fuso: string, virada: string): Data`; `idadeEm(nascimento: Data, em: Data): number`
  - `interface Relogio { agora(): Date }`; `relogioSistema`; `class RelogioFixo implements Relogio { constructor(iso: string); definir(iso: string): void; avancarHoras(h: number): void }`
  - `novoId(): string` (UUID v4 via `crypto.randomUUID`)
  - `class ErroDominio extends Error { constructor(codigo: string, mensagem: string, detalhes?: unknown) }`
  - `abrirBanco(caminho: string): Kysely<any>` (better-sqlite3, pragmas WAL e foreign_keys); `migrar(db, migracoes: Migracao[]): Promise<void>` usando o `Migrator` do Kysely com um provider em memória; `type Migracao = { nome: string; up(db: Kysely<any>): Promise<void> }`
  - `interface Contexto { db: Kysely<any>; relogio: Relogio; barramento: Barramento }`; `emTransacao<T>(ctx: Contexto, fn: (tx: Contexto) => Promise<T>): Promise<T>` — executa em transação e, **após o commit**, despacha no barramento os eventos acumulados (barramento definido na Task 2; nesta task, `Barramento` é só a interface `{ publicar(e): void }`)
  - `test/ajuda.ts`: `criarContextoTeste(iso = "2026-11-10T15:00:00Z"): Promise<Contexto & { relogio: RelogioFixo }>` (banco `:memory:` com todas as migrações registradas até então)

- [ ] **Step 1: Criar a estrutura**: `package.json` raiz com `"workspaces": ["apps/*"]` e `"private": true`; em `apps/server`: dependências `fastify@^5`, `kysely@^0.28`, `better-sqlite3@^12`, `zod@^4`; dev: `typescript@^5.9`, `vitest@^3`, `tsx@^4`, `@types/better-sqlite3`, `@types/node@^24`. Scripts: `"test": "vitest run"`, `"dev": "tsx watch src/main.ts"`, `"typecheck": "tsc --noEmit"`. `tsconfig` com `strict`, `module`/`moduleResolution` `NodeNext`, `target` `ES2023`. `.gitignore`: `node_modules`, `*.db`, `*.db-*`, `dist`. Rodar `npm install`.

- [ ] **Step 2: Escrever os testes que falham**

```ts
// test/shared/dinheiro.test.ts
test("cadeia de percentuais do exemplo da spec", () => {
  let v = 30000;
  for (const p of [20, 15, 10]) v = aplicarPercentual(v, p);
  expect(arredondarCentavos(v)).toBe(45540);
});
test("arredondarCentavos meio para longe do zero", () => {
  expect(arredondarCentavos(100.5)).toBe(101);
  expect(arredondarCentavos(-100.5)).toBe(-101);
});
test("arredondarReal", () => { expect(arredondarReal(45540)).toBe(45500); expect(arredondarReal(45550)).toBe(45600); });
test("formatarBRL", () => { expect(formatarBRL(45540)).toBe("R$ 455,40"); });

// test/shared/tempo.test.ts
test("noites exclui a saída", () => { expect(noites("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]); });
test("diaHoteleiro antes da virada é o dia anterior", () => {
  expect(diaHoteleiro(new Date("2026-11-10T06:59:00Z"), "America/Sao_Paulo", "04:00")).toBe("2026-11-09"); // 03:59 local
  expect(diaHoteleiro(new Date("2026-11-10T07:00:00Z"), "America/Sao_Paulo", "04:00")).toBe("2026-11-10");
});
test("idadeEm considera aniversário", () => { expect(idadeEm("2020-12-31", "2026-12-30")).toBe(5); expect(idadeEm("2020-12-31", "2026-12-31")).toBe(6); });

// test/shared/banco.test.ts
test("banco abre com WAL e foreign keys", async () => {
  const db = abrirBanco(join(tmpdir(), `t-${novoId()}.db`));
  const { rows } = await sql`PRAGMA journal_mode`.execute(db);
  expect((rows[0] as any).journal_mode).toBe("wal");
  const fk = await sql`PRAGMA foreign_keys`.execute(db);
  expect((fk.rows[0] as any).foreign_keys).toBe(1);
});
```

- [ ] **Step 3: Rodar e ver falhar** — `npm test -w apps/server` → FAIL (módulos inexistentes).

- [ ] **Step 4: Implementar** os arquivos de `src/shared` e `test/ajuda.ts` conforme Interfaces. Aritmética de datas em UTC (`Date.UTC`) sobre strings; `dataLocal`/`horaLocal` com `Intl.DateTimeFormat("en-CA", { timeZone })`.

- [ ] **Step 5: Rodar** — `npm test -w apps/server` → PASS; `npm run typecheck -w apps/server` → sem erros.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: fundação do servidor local e utilitários compartilhados"`

---

### Task 2: Infraestrutura — outbox, barramento, auditoria e alertas

**Files:**
- Create: `apps/server/src/infra/{outbox,barramento,auditoria,alertas,migracao}.ts`
- Test: `apps/server/test/infra/infra.test.ts`

**Interfaces:**
- Consumes: `Contexto`, `emTransacao`, `novoId` (Task 1)
- Produces:
  - Tabelas: `outbox(id TEXT PK, seq INTEGER UNIQUE autoincremento, tipo, payload JSON, criado_em, enviado_em NULL)`; `auditoria(id, instante, ator, acao, alvo_tipo, alvo_id, motivo NULL, supervisor_id NULL, dados JSON)`; `alertas(id, tipo, alvo_tipo, alvo_id, mensagem, criado_em, resolvido_em NULL, resolvido_por NULL)`
  - `registrarEvento(tx: Contexto, tipo: string, payload: object): Promise<{ id: string; seq: number }>` — grava no outbox e agenda publicação pós-commit
  - `class Barramento { assinar(tipo: string, fn: (e: Evento) => void | Promise<void>): void; publicar(e: Evento): void }`; `type Evento = { id; seq; tipo; payload; criadoEm }`
  - `auditar(tx: Contexto, a: { ator: string; acao: string; alvoTipo: string; alvoId: string; motivo?: string; supervisorId?: string; dados?: object }): Promise<void>`; `const ATOR_SISTEMA = "Sistema"`
  - `criarAlerta(tx, a: { tipo: string; alvoTipo: string; alvoId: string; mensagem: string }): Promise<string>` — **não duplica** alerta aberto com mesmo `tipo`+`alvoId`; `resolverAlerta(tx, id, usuarioId)`; `alertasAbertos(ctx): Promise<Alerta[]>`
  - `migracaoInfra: Migracao` (registrada em `test/ajuda.ts` e futuramente em `main.ts`)

- [ ] **Step 1: Testes que falham**

```ts
test("eventos recebem seq crescente e ids únicos", async () => {
  const ctx = await criarContextoTeste();
  const a = await emTransacao(ctx, tx => registrarEvento(tx, "x.A", {}));
  const b = await emTransacao(ctx, tx => registrarEvento(tx, "x.B", {}));
  expect(b.seq).toBeGreaterThan(a.seq); expect(b.id).not.toBe(a.id);
});
test("evento de transação revertida não fica no outbox nem é publicado", async () => {
  const ctx = await criarContextoTeste(); const recebidos: string[] = [];
  ctx.barramento.assinar("x.A", e => { recebidos.push(e.tipo); });
  await expect(emTransacao(ctx, async tx => { await registrarEvento(tx, "x.A", {}); throw new Error("falhou"); })).rejects.toThrow();
  expect(await ctx.db.selectFrom("outbox").selectAll().execute()).toHaveLength(0);
  expect(recebidos).toEqual([]);
});
test("evento é publicado após o commit", async () => { /* assinar, registrar, esperar recebidos == ["x.A"] */ });
test("auditoria registra ator Sistema", async () => { /* auditar(ATOR_SISTEMA, ...) → linha com ator "Sistema" */ });
test("alerta aberto não duplica", async () => {
  const ctx = await criarContextoTeste();
  const a = { tipo: "sinal_vencido", alvoTipo: "reserva", alvoId: "r1", mensagem: "m" };
  await emTransacao(ctx, tx => criarAlerta(tx, a)); await emTransacao(ctx, tx => criarAlerta(tx, a));
  expect(await alertasAbertos(ctx)).toHaveLength(1);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run test/infra` → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces; `emTransacao` acumula eventos numa lista do `tx` e publica só após `commit`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(infra): outbox, barramento, auditoria e alertas`

---

### Task 3: Núcleo — pousada, categorias e quartos

**Files:**
- Create: `apps/server/src/nucleo/{pousada,categorias,quartos,migracao}.ts`
- Test: `apps/server/test/nucleo/cadastros-quartos.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2
- Produces:
  - `type ConfigPousada = { razaoSocial; cnpj; endereco; fuso: string /* "America/Sao_Paulo" */; horaCheckin: string /* "14:00" */; horaCheckout: string /* "12:00" */; viradaDia: string /* "04:00" */; arredondamento: "nenhum" | "real"; sinal: { exigir: boolean; tipo: "percentual" | "primeira_diaria"; percentual: number; prazoHoras: number; toleranciaHoras: number }; earlyCheckin: RegraTaxa; lateCheckout: RegraTaxa; idadeAdulto: number /* 12 */; limiteCriancasGratis: number }`; `type RegraTaxa = { tipo: "fixo" | "percentual_diaria"; valor: number }`
  - `obterConfig(ctx): Promise<ConfigPousada>` (linha única; padrões: fuso SP, 14:00, 12:00, 04:00, "nenhum", sinal `{exigir:true, tipo:"percentual", percentual:30, prazoHoras:48, toleranciaHoras:12}`, idadeAdulto 12, limiteCriancasGratis 1); `salvarConfig(ctx, parcial, ator)`
  - `criarCategoria(ctx, { nome; maxAdultos; maxCriancas; comodidades: string[] }, ator): Promise<Categoria>`; `listarCategorias(ctx)`
  - `type SituacaoQuarto = "livre" | "ocupado" | "sujo" | "em_manutencao" | "bloqueado"`
  - `criarQuarto(ctx, { numero; categoriaId; bloco?: string }, ator): Promise<Quarto>` (número único → `NUMERO_QUARTO_DUPLICADO`); `listarQuartos(ctx, filtro?: { categoriaId? })`; `obterQuarto(ctx, id)`
  - `mudarSituacaoQuarto(tx, quartoId, nova: SituacaoQuarto, ator: string, motivo?: string): Promise<void>` — transições permitidas: `livre→ocupado|em_manutencao|bloqueado`, `ocupado→sujo`, `sujo→livre|em_manutencao`, `em_manutencao→livre|sujo`, `bloqueado→livre`; outras → `TRANSICAO_QUARTO_INVALIDA`. Emite `nucleo.SituacaoQuartoAlterada`.

- [ ] **Step 1: Testes que falham**

```ts
test("config tem padrões da spec", async () => {
  const c = await obterConfig(await criarContextoTeste());
  expect(c).toMatchObject({ horaCheckin: "14:00", horaCheckout: "12:00", viradaDia: "04:00", arredondamento: "nenhum", idadeAdulto: 12, limiteCriancasGratis: 1 });
});
test("número de quarto duplicado é rejeitado", async () => { /* criar "12" duas vezes → ErroDominio NUMERO_QUARTO_DUPLICADO */ });
test("quarto ocupado não pode ir direto para livre", async () => {
  /* livre→ocupado ok; ocupado→livre → TRANSICAO_QUARTO_INVALIDA; ocupado→sujo ok; sujo→livre ok */
});
test("mudança de situação emite evento e auditoria", async () => { /* outbox tem nucleo.SituacaoQuartoAlterada; auditoria acao "quarto.situacao" */ });
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** conforme Interfaces; registrar `migracaoNucleo` em `test/ajuda.ts`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(nucleo): pousada, categorias e quartos`

---

### Task 4: Núcleo — hóspedes, produtos e formas de pagamento

**Files:**
- Create: `apps/server/src/nucleo/{hospedes,produtos,formas-pagamento}.ts` (estender `nucleo/migracao.ts`)
- Test: `apps/server/test/nucleo/cadastros-gerais.test.ts`

**Interfaces:**
- Produces:
  - `type Hospede = { id; nome; documentoTipo: "cpf" | "passaporte"; documento: string | null; nascimento: Data | null; nacionalidade: string; telefone?; email?; endereco?: { logradouro; cidade; uf; pais; cep? }; observacoes? }`
  - `salvarHospede(ctx, dados, ator): Promise<Hospede>` (cria ou atualiza por `id`); CPF validado pelos dígitos verificadores → `CPF_INVALIDO`; documento único por tipo → `DOCUMENTO_DUPLICADO`
  - `buscarHospedes(ctx, termo: string): Promise<Hospede[]>` — por nome (contém, sem acento/caixa) ou documento (só dígitos)
  - `pendenciasFnrh(h: Hospede, adulto: boolean): string[]` — adulto: exige `nome, documento, nascimento, nacionalidade, endereco.cidade` e (`telefone` ou `email`); criança: `nome, nascimento`. Retorna nomes dos campos faltantes.
  - `historicoEstadias` fica para a Task 17 (consulta).
  - `criarProduto(ctx, { codigo; nome; precoCentavos; unidade; grupo; tipo: "produto" | "servico" }, ator)`; `obterProdutoPorCodigo(ctx, codigo)`. Seeds na migração: `EARLY_CHECKIN`, `LATE_CHECKOUT`, `CAMA_EXTRA` (serviços, preço 0, editáveis).
  - `type FormaPagamento = { id; codigo: "dinheiro" | "pix" | "debito" | "credito" | "faturado"; nome; ativa: boolean }` — seeds das 5 ativas; `listarFormas(ctx, apenasAtivas = true)`; `ativarForma(ctx, codigo, ativa, ator)`

- [ ] **Step 1: Testes que falham**

```ts
test("CPF inválido é rejeitado", async () => { /* documento "123.456.789-00" → CPF_INVALIDO; "529.982.247-25" aceito e gravado como "52998224725" */ });
test("estrangeiro com passaporte não passa por validação de CPF", async () => { /* documentoTipo passaporte "AB123456" aceito */ });
test("busca ignora acento e caixa", async () => { /* salva "José Antônio"; buscarHospedes("jose antonio") retorna 1 */ });
test("pendenciasFnrh de adulto incompleto", () => {
  expect(pendenciasFnrh({ nome: "Ana", documentoTipo: "cpf", documento: null, nascimento: null, nacionalidade: "BR" } as Hospede, true))
    .toEqual(expect.arrayContaining(["documento", "nascimento", "endereco.cidade", "contato"]));
});
test("formas de pagamento padrão", async () => { expect((await listarFormas(ctx)).map(f => f.codigo)).toEqual(["dinheiro", "pix", "debito", "credito", "faturado"]); });
```

- [ ] **Step 2: Rodar e ver falhar.** - [ ] **Step 3: Implementar.** - [ ] **Step 4: Rodar → PASS.**
- [ ] **Step 5: Commit** — `feat(nucleo): hóspedes, produtos e formas de pagamento`

---

### Task 5: Usuários, permissões, sessão, supervisor e API HTTP base

**Files:**
- Create: `apps/server/src/nucleo/{usuarios,permissoes,sessoes,supervisor,rotas}.ts`, `apps/server/src/http/{app,autenticacao,erros-http}.ts`
- Test: `apps/server/test/nucleo/usuarios.test.ts`, `apps/server/test/http/app.test.ts`

**Interfaces:**
- Produces:
  - Permissões (strings): `cadastros.gerenciar`, `tarifas.gerenciar`, `reservas.gerenciar`, `hospedagem.checkin`, `hospedagem.checkout`, `conta.lancar`, `caixa.operar`, `quartos.situacao`, `quartos.manutencao`, `config.gerenciar`, `supervisor`
  - Perfis padrão (seed, ajustáveis em `perfil_permissoes`): `admin` = todas, `limiteDesconto 100`; `recepcao` = todas menos `cadastros.gerenciar`, `tarifas.gerenciar`, `config.gerenciar`, `supervisor`, `limiteDesconto 5`; `governanca` = só `quartos.situacao`, `limiteDesconto 0`
  - `criarUsuario(ctx, { nome; login; senha; perfil }, ator)` — senha com `scrypt` + salt; `login` único
  - `entrar(ctx, login, senha): Promise<{ token: string; usuario: UsuarioSessao }>` → `CREDENCIAIS_INVALIDAS`; `type UsuarioSessao = { id; nome; perfil; permissoes: string[]; limiteDesconto: number }`; `sessaoPorToken(ctx, token)`; `sair(ctx, token)`
  - `exigirPermissao(u: UsuarioSessao, p: string): void` → `SEM_PERMISSAO`
  - `autorizarSupervisor(ctx, cred: { login: string; senha: string } | undefined, motivo: string | undefined): Promise<{ supervisorId: string; motivo: string }>` → `SUPERVISOR_NECESSARIO` (sem cred), `MOTIVO_OBRIGATORIO` (motivo vazio), `CREDENCIAIS_INVALIDAS`, `SEM_PERMISSAO` (usuário sem `supervisor`)
  - `criarApp(ctx: Contexto): FastifyInstance` — hook de autenticação Bearer (exceto `POST /api/sessoes`), `req.usuario: UsuarioSessao`; mapeia `ErroDominio` → HTTP 422 `{ codigo, mensagem, detalhes }`, `SEM_PERMISSAO` → 403, sem sessão → 401, erro zod → 400 `{ codigo: "DADOS_INVALIDOS", campos }`
  - Convenção de rotas: cada módulo exporta `registrarRotasX(app, ctx)`; corpo validado com zod; ações sensíveis recebem `{ motivo, supervisor: { login, senha } }` no corpo.
  - Rotas desta task: `POST /api/sessoes`, `DELETE /api/sessoes`, `GET/PUT /api/config`, `GET/POST /api/categorias`, `GET/POST /api/quartos`, `GET/POST /api/hospedes`, `GET /api/hospedes?q=`, `GET/POST /api/produtos`, `GET /api/formas-pagamento`, `POST /api/usuarios`
  - Na migração: usuário inicial `admin` / senha `admin` com flag `trocarSenha: true` (a interface do Plano B força a troca).

- [ ] **Step 1: Testes que falham**

```ts
test("login errado", async () => { await expect(entrar(ctx, "admin", "x")).rejects.toMatchObject({ codigo: "CREDENCIAIS_INVALIDAS" }); });
test("supervisor exige motivo e permissão", async () => {
  await criarUsuario(ctx, { nome: "Rec", login: "rec", senha: "123", perfil: "recepcao" }, "admin");
  await expect(autorizarSupervisor(ctx, { login: "admin", senha: "admin" }, "  ")).rejects.toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
  await expect(autorizarSupervisor(ctx, { login: "rec", senha: "123" }, "ok")).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  await expect(autorizarSupervisor(ctx, undefined, "ok")).rejects.toMatchObject({ codigo: "SUPERVISOR_NECESSARIO" });
});
test("governança não cria quarto (403)", async () => { /* app.inject POST /api/quartos com token de governança → 403 */ });
test("sem token → 401; erro de domínio → 422 com codigo", async () => { /* POST /api/quartos duplicado → 422 NUMERO_QUARTO_DUPLICADO */ });
test("corpo inválido → 400 DADOS_INVALIDOS", async () => { /* POST /api/quartos sem numero */ });
```

- [ ] **Step 2: Rodar e ver falhar.** - [ ] **Step 3: Implementar.** - [ ] **Step 4: Rodar → PASS.**
- [ ] **Step 5: Commit** — `feat(nucleo): usuários, permissões, supervisor e API base`

---

### Task 6: Turnos de caixa

**Files:**
- Create: `apps/server/src/nucleo/caixa.ts` (rotas em `nucleo/rotas.ts`)
- Test: `apps/server/test/nucleo/caixa.test.ts`

**Interfaces:**
- Produces:
  - Tabelas: `turnos_caixa(id, usuario_id, aberto_em, valor_inicial, fechado_em NULL, contados JSON NULL)`; `movimentos_caixa(id, turno_id, forma_codigo, valor /* +/− centavos */, origem_tipo, origem_id, instante)` (somente inserção)
  - `abrirCaixa(ctx, usuarioId, valorInicial: Centavos)` → `CAIXA_JA_ABERTO` se o usuário já tem turno aberto
  - `turnoAberto(ctx, usuarioId): Promise<Turno | null>`; `exigirCaixaAberto(tx, usuarioId): Promise<Turno>` → `CAIXA_FECHADO`
  - `registrarMovimento(tx, turnoId, { formaCodigo, valor, origemTipo, origemId }): Promise<void>` (usado pela Task 11)
  - `fecharCaixa(ctx, usuarioId, contados: Record<string, Centavos>): Promise<RelatorioTurno>`; `type RelatorioTurno = { porForma: { forma; esperado; contado; diferenca }[] }` — esperado de `dinheiro` inclui `valorInicial`
  - Rotas: `POST /api/caixa/abrir`, `POST /api/caixa/fechar`, `GET /api/caixa/atual` (exigem `caixa.operar`)

- [ ] **Step 1: Testes que falham**

```ts
test("fechamento mostra diferença por forma", async () => {
  await abrirCaixa(ctx, u, 10000);
  await emTransacao(ctx, async tx => { const t = await exigirCaixaAberto(tx, u);
    await registrarMovimento(tx, t.id, { formaCodigo: "dinheiro", valor: 5000, origemTipo: "teste", origemId: "1" });
    await registrarMovimento(tx, t.id, { formaCodigo: "pix", valor: 20000, origemTipo: "teste", origemId: "2" }); });
  const r = await fecharCaixa(ctx, u, { dinheiro: 14000, pix: 20000 });
  expect(r.porForma).toEqual(expect.arrayContaining([
    { forma: "dinheiro", esperado: 15000, contado: 14000, diferenca: -1000 },
    { forma: "pix", esperado: 20000, contado: 20000, diferenca: 0 }]));
});
test("sem caixa aberto não registra", async () => { await expect(emTransacao(ctx, tx => exigirCaixaAberto(tx, u))).rejects.toMatchObject({ codigo: "CAIXA_FECHADO" }); });
test("não abre dois turnos", async () => { /* abrir duas vezes → CAIXA_JA_ABERTO */ });
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(nucleo): turnos de caixa`

---

### Task 7: Tarifas — cálculo puro da diária

**Files:**
- Create: `apps/server/src/tarifas/{tipos,criancas,calculo}.ts`
- Test: `apps/server/test/tarifas/calculo.test.ts`

**Interfaces:**
- Consumes: `aplicarPercentual`, `arredondarCentavos`, `arredondarReal`, `diaDaSemana`, `idadeEm` (Task 1)
- Produces (funções **puras**, sem banco):
  - `type TabelaBase = { porAdultos: Record<1 | 2 | 3, Centavos>; adultoExtra: Centavos }`
  - `type FaixaCrianca = { idadeMin: number; idadeMax: number; tipo: "gratis" | "percentual_adicional" | "fixo"; valor: number }` (`percentual_adicional` = % de `adultoExtra`)
  - `type RegrasNoite = { tabelaPadrao: TabelaBase; temporada?: { nome: string; tabela?: TabelaBase; percentual?: number }; percentualDiaSemana?: number; canal: { nome: string; percentual: number }; faixasOcupacao: { acimaDe: number; percentual: number }[]; ocupacaoPct: number; piso?: Centavos; teto?: Centavos; pacote?: { nome: string; valorNoite: Record<1 | 2 | 3, Centavos> }; faixasCrianca: FaixaCrianca[]; limiteCriancasGratis: number; idadeAdulto: number; arredondamento: "nenhum" | "real" }`
  - `type Hospedes = { adultos: number; criancasNascimento: Data[] }` — `classificarCriancas(h, chegada, faixas, idadeAdulto, limiteGratis): { adultosEfetivos: number; criancas: { idade: number; faixa: FaixaCrianca }[] }` — crianças com idade ≥ `idadeAdulto` viram adultos; crianças grátis além do limite passam à **primeira faixa pagante** (menor `idadeMin` com tipo ≠ `gratis`); idade na **data de chegada**
  - `calcularNoite(data: Data, chegada: Data, h: Hospedes, r: RegrasNoite): ValorNoite`; `type ValorNoite = { data: Data; valor: Centavos; passos: { rotulo: string; valor: Centavos }[] }`
  - **Algoritmo** (ordem fixa da spec):
    1. tabela = `temporada.tabela ?? tabelaPadrao`; adultos: `porAdultos[min(adultosEfetivos,3)] + max(0, adultosEfetivos−3) × adultoExtra`; soma crianças pela faixa. Passo `"Base"`.
    2. se `temporada.percentual` → aplica; passo `"<nome temporada> ±X%"`.
    3. `percentualDiaSemana` → passo `"<Sábado> +X%"`.
    4. `canal.percentual` ≠ 0 → passo `"<canal> ±X%"`.
    5. maior faixa com `ocupacaoPct > acimaDe` → passo `"Ocupação N% +X%"`.
    6. limita a `[piso, teto]` → passo `"Piso"`/`"Teto"` quando agir.
    7. se `pacote`: substitui tudo acima por `valorNoite[min(adultos,3)]` + crianças pela faixa (sem percentuais, sem piso/teto); passos = `["Pacote <nome>", crianças]`.
    8. `arredondarCentavos`, depois `arredondarReal` se configurado.
    Percentuais são aplicados sem arredondar entre camadas; só o valor final é arredondado. O `valor` de cada passo é exibido arredondado.

- [ ] **Step 1: Testes que falham**

```ts
const base: RegrasNoite = { tabelaPadrao: { porAdultos: { 1: 25000, 2: 30000, 3: 36000 }, adultoExtra: 8000 },
  canal: { nome: "Balcão", percentual: 0 }, faixasOcupacao: [{ acimaDe: 70, percentual: 10 }, { acimaDe: 90, percentual: 25 }],
  ocupacaoPct: 0, faixasCrianca: [{ idadeMin: 0, idadeMax: 5, tipo: "gratis", valor: 0 }, { idadeMin: 6, idadeMax: 11, tipo: "percentual_adicional", valor: 50 }],
  limiteCriancasGratis: 1, idadeAdulto: 12, arredondamento: "nenhum" };
const casal = { adultos: 2, criancasNascimento: [] };

test("exemplo da spec: 300 → Alta +20% → Sábado +15% → Ocupação 85% +10% = 455,40", () => {
  const r = calcularNoite("2026-11-14", "2026-11-14", casal, { ...base, temporada: { nome: "Alta", percentual: 20 }, percentualDiaSemana: 15, ocupacaoPct: 85 });
  expect(r.valor).toBe(45540);
  expect(r.passos.map(p => p.rotulo)).toEqual(["Base", "Alta +20%", "Sábado +15%", "Ocupação 85% +10%"]);
});
test("temporada com tabela própria substitui a base", () => { /* temporada { nome:"Réveillon", tabela: {2: 80000...} } → 80000 */ });
test("canal deriva do balcão", () => { expect(calcularNoite(d, d, casal, { ...base, canal: { nome: "Agência", percentual: -20 } }).valor).toBe(24000); });
test("teto limita a dinâmica", () => { expect(calcularNoite(d, d, casal, { ...base, ocupacaoPct: 95, teto: 35000 }).valor).toBe(35000); });
test("4 adultos usam adulto extra", () => { expect(calcularNoite(d, d, { adultos: 4, criancasNascimento: [] }, base).valor).toBe(44000); });
test("duas crianças de 4 anos com limite 1 grátis: a segunda paga a primeira faixa pagante", () => {
  const r = calcularNoite(d, "2026-11-14", { adultos: 2, criancasNascimento: ["2022-01-01", "2022-02-01"] }, base);
  expect(r.valor).toBe(30000 + 4000);
});
test("criança de 12 anos conta como adulto", () => { /* nascimento 2014-11-01, chegada 2026-11-14 → 3 adultos → 36000 */ });
test("idade é a da chegada, não da noite", () => { /* faz 6 anos no meio da estadia: noite posterior continua grátis */ });
test("pacote ignora percentuais e piso/teto", () => { /* pacote valorNoite{2:50000}, ocupação 95 → 50000 */ });
test("arredondamento comercial para o real", () => { /* 45540 com "real" → 45500 */ });
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(tarifas): cálculo da diária em camadas`

---

### Task 8: Tarifas — regras persistidas, ocupação, cotação, restrições e simulador

**Files:**
- Create: `apps/server/src/tarifas/{regras,ocupacao,cotacao,restricoes,migracao,rotas}.ts`
- Test: `apps/server/test/tarifas/cotacao.test.ts`

**Interfaces:**
- Consumes: `calcularNoite`, tipos (Task 7); `obterConfig`, categorias (Task 3)
- Produces:
  - Tabelas: `tabelas_base(categoria_id PK, por_adultos JSON, adulto_extra, piso NULL, teto NULL)`; `temporadas(id, nome, inicio, fim /* inclusive */, prioridade, percentual NULL)` + `temporada_tabelas(temporada_id, categoria_id, por_adultos, adulto_extra)`; `percentuais_dia_semana(dia 0..6, percentual)`; `canais(id, nome UNIQUE, percentual, exige_sinal BOOLEAN)` com seed `Balcão 0 exige_sinal=1`; `faixas_ocupacao(acima_de, percentual)`; `faixas_crianca(...)`; `pacotes(id, nome, categoria_id, inicio, fim /* noites inclusive */, min_noites, valor_noite JSON, ativo)`; `restricoes(categoria_id, data, min_noites NULL, fechado_chegada, fechado_saida, fechado_venda)`
  - CRUD: `salvarTabelaBase`, `salvarTemporada`, `salvarPercentualDiaSemana`, `salvarCanal`, `salvarFaixasOcupacao`, `salvarFaixasCrianca`, `salvarPacote`, `salvarRestricao` — todos `(ctx, dados, ator)`, exigem `tarifas.gerenciar` na rota
  - `ocupacaoCategoria(ctx, categoriaId, data, ignorarReservaId?): Promise<number>` — % = reservas em `pre_reserva|confirmada|hospedada` da categoria cobrindo a noite ÷ quartos da categoria que não estão `em_manutencao|bloqueado` × 100.
  - A ocupação precisa da tabela `reservas`, então **esta task cria `apps/server/src/hospedagem/migracao.ts`** com as tabelas de hospedagem listadas na Task 9 (`reservas`, `reserva_noites`, `acompanhantes`, `grupos`, `contas`). Os testes desta task inserem reservas mínimas via SQL direto.
  - `type PedidoCotacao = { categoriaId; chegada: Data; saida: Data; hospedes: Hospedes; canal: string; ignorarReservaId?: string }`
  - `cotar(ctx, p: PedidoCotacao): Promise<Cotacao>`; `type Cotacao = { noites: ValorNoite[]; total: Centavos; violacoes: Violacao[] }`
  - Temporada da noite = a de **maior prioridade** que contém a data. Pacote aplica-se se ativo, mesma categoria e nº de noites da estadia dentro de `[inicio, fim]` ≥ `min_noites`; aplica-se **só às noites cobertas**.
  - `verificarRestricoes(ctx, categoriaId, chegada, saida): Promise<Violacao[]>`; `type Violacao = { codigo: "MIN_NOITES" | "FECHADO_CHEGADA" | "FECHADO_SAIDA" | "FECHADO_VENDA"; data: Data; mensagem: string }` — `min_noites` da **data de chegada**; `fechado_venda` em qualquer noite
  - Rotas: `POST /api/tarifas/simular` (corpo `PedidoCotacao`, retorna `Cotacao`) e CRUD das regras em `/api/tarifas/*`

- [ ] **Step 1: Testes que falham**

```ts
test("estadia atravessando temporada precifica cada noite pela sua data", async () => {
  // Alta (+20%) de 2026-12-20 a 2027-01-10; estadia 2026-12-18 → 2026-12-22
  const c = await cotar(ctx, { categoriaId: std, chegada: "2026-12-18", saida: "2026-12-22", hospedes: casal, canal: "Balcão" });
  expect(c.noites.map(n => n.valor)).toEqual([30000, 30000, 36000, 36000]);
  expect(c.total).toBe(132000);
});
test("temporadas sobrepostas: vale a de maior prioridade", async () => { /* Alta prio 1 +20%, Réveillon prio 2 +50% em 31/12 → 45000 */ });
test("pacote só nas noites cobertas e só com mínimo de noites", async () => {
  // Pacote Réveillon 2026-12-29..2027-01-01, min 3, valorNoite {2: 50000}
  // estadia 12-28 → 01-02 (5 noites, 4 cobertas) → [36000, 50000, 50000, 50000, 50000]
  // estadia 12-30 → 01-01 (2 cobertas) → sem pacote
});
test("ocupação dinâmica usa reservas da categoria na data", async () => { /* 10 quartos, 8 reservas na noite → 80% → +10% */ });
test("quarto em manutenção sai do denominador da ocupação", async () => {});
test("restrições: mínimo de noites e fechado para chegada", async () => {
  // min_noites 3 em 2026-12-31; chegada 31 saída 01-02 → violacao MIN_NOITES
});
test("simulador via HTTP retorna detalhamento", async () => { /* POST /api/tarifas/simular → 200, noites[0].passos[0].rotulo "Base" */ });
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(tarifas): regras, ocupação, cotação, restrições e simulador`

---

### Task 9: Reservas — estados e criação

**Files:**
- Create: `apps/server/src/hospedagem/{estados,disponibilidade,reservas,rotas}.ts` (estender `hospedagem/migracao.ts`)
- Test: `apps/server/test/hospedagem/reservas.test.ts`

**Interfaces:**
- Consumes: `cotar`, `verificarRestricoes` (Task 8); `autorizarSupervisor` (Task 5); `obterConfig` (Task 3)
- Produces:
  - `type EstadoReserva = "pre_reserva" | "confirmada" | "hospedada" | "finalizada" | "cancelada" | "no_show"`
  - `transicionar(de: EstadoReserva, para: EstadoReserva): void` → `TRANSICAO_RESERVA_INVALIDA`. Válidas: `pre_reserva→confirmada|cancelada`, `confirmada→hospedada|cancelada|no_show`, `hospedada→finalizada`.
  - Tabelas (a migração já existe desde a Task 8; esta task só a usa): `reservas(id, codigo INTEGER UNIQUE /* sequencial, começa em 1 */, estado, titular_id, categoria_id, quarto_id NULL, chegada, saida, adultos, criancas JSON /* nascimentos */, canal, observacoes, grupo_id NULL, conta_id, valor_sinal, prazo_sinal NULL, aviso_sinal_em NULL, criada_em)`; `reserva_noites(reserva_id, data, valor, passos JSON, PRIMARY KEY(reserva_id, data))` (preço congelado); `acompanhantes(reserva_id, hospede_id)`; `grupos(id, titular_id, cobranca: "unica" | "separada")`; `contas(id, titular_id, situacao: "aberta" | "fechada")`
  - `verificarDisponibilidade(tx, { categoriaId; quartoId?; chegada; saida; ignorarReservaId? }): Promise<void>` → `QUARTO_INDISPONIVEL` (quarto com reserva ativa sobreposta, ou em `em_manutencao|bloqueado`) ou `CATEGORIA_LOTADA` (em alguma noite, reservas ativas da categoria ≥ quartos disponíveis). Reservas ativas = `pre_reserva|confirmada|hospedada`.
  - `type NovaReserva = { titularId; categoriaId; quartoId?; chegada; saida; adultos; criancasNascimento: Data[]; canal; observacoes?; descontoPercentual?: number; grupoId?: string; autorizacao?: { motivo: string; supervisor: { login; senha } } }`
  - `criarReserva(ctx, dados: NovaReserva, usuario: UsuarioSessao): Promise<Reserva>` — em **uma transação**: valida capacidade da categoria (`maxAdultos`, `maxCriancas` → `CAPACIDADE_EXCEDIDA`); `verificarRestricoes` (violações exigem `autorizacao` → `RESTRICAO_TARIFARIA` com `detalhes: violacoes`); `verificarDisponibilidade`; `cotar`; desconto: `descontoPercentual > usuario.limiteDesconto` exige `autorizacao`, aplicado a cada noite com passo `"Desconto −X%"`; grava `reserva_noites`; conta: grupo `unica` → conta do grupo, senão nova conta; sinal: se `config.sinal.exigir` **e** `canal.exige_sinal` → `pre_reserva`, `valor_sinal` = `arredondarCentavos(total × percentual / 100)` ou valor da 1ª noite, `prazo_sinal = agora + prazoHoras`; senão `confirmada` e `valor_sinal = 0`. Emite `hospedagem.ReservaCriada`; audita.
  - **A conta é criada junto com a reserva** (para receber o sinal); diárias só são lançadas a partir do check-in (Task 13).
  - `criarGrupo(ctx, { titularId; cobranca }, usuario)`; `obterReserva(ctx, id): Promise<ReservaDetalhe>` (inclui noites, total, pagoSinal na Task 11)
  - Rotas: `POST /api/reservas`, `GET /api/reservas/:id`, `POST /api/grupos` (`reservas.gerenciar`)

- [ ] **Step 1: Testes que falham**

```ts
test("reserva com sinal nasce pre_reserva com valor e prazo", async () => {
  const r = await criarReserva(ctx, { titularId, categoriaId: std, chegada: "2026-11-20", saida: "2026-11-23", adultos: 2, criancasNascimento: [], canal: "Balcão" }, recepcao);
  expect(r.estado).toBe("pre_reserva"); expect(r.valorSinal).toBe(27000); // 30% de 90000
  expect(r.prazoSinal).toBe("2026-11-12T15:00:00.000Z");                 // agora + 48h
});
test("canal sem exigência de sinal nasce confirmada", async () => {});
test("preço congela: mudar a tabela depois não altera a reserva", async () => {});
test("Review Focus 1: duas reservas simultâneas do mesmo quarto — a segunda falha", async () => {
  const p = (n: string) => criarReserva(ctx, { ...dados, quartoId: q12 }, recepcao);
  const res = await Promise.allSettled([p("a"), p("b")]);
  expect(res.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect((res.find(x => x.status === "rejected") as any).reason.codigo).toBe("QUARTO_INDISPONIVEL");
});
test("categoria lotada sem quarto atribuído", async () => { /* 1 quarto, 2 reservas sem quarto na mesma noite → CATEGORIA_LOTADA */ });
test("desconto acima do limite exige supervisor", async () => { /* recepcao limite 5; 10% sem autorizacao → SUPERVISOR_NECESSARIO; com admin → ok e noites com passo "Desconto −10%" */ });
test("restrição de data exige supervisor", async () => { /* RESTRICAO_TARIFARIA */ });
test("capacidade excedida", async () => { /* 5 adultos em categoria maxAdultos 3 → CAPACIDADE_EXCEDIDA */ });
test("grupo com cobrança única compartilha a conta", async () => {});
test("transições inválidas", () => { expect(() => transicionar("finalizada", "hospedada")).toThrow(/TRANSICAO_RESERVA_INVALIDA/); });
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): estados e criação de reservas`

---

### Task 10: Reservas — alteração, cancelamento, no-show e prorrogação de sinal

**Files:**
- Create: `apps/server/src/hospedagem/alteracao.ts` (rotas em `hospedagem/rotas.ts`)
- Test: `apps/server/test/hospedagem/alteracao.test.ts`

**Interfaces:**
- Consumes: Task 9
- Produces:
  - `previaAlteracao(ctx, reservaId, mudanca: Mudanca): Promise<{ valorAntigo: Centavos; valorNovo: Centavos; noites: ValorNoite[] }>`; `type Mudanca = { quartoId?: string | null; categoriaId?; chegada?; saida?; adultos?; criancasNascimento?: Data[]; precosManuais?: { data: Data; valor: Centavos }[] }`
  - `precosManuais` altera o preço congelado de noites ainda não lançadas: ação sensível (exige `autorizacao`), passo `"Ajuste manual"` no detalhamento; noite já lançada → `NOITE_JA_LANCADA`
  - `alterarReserva(ctx, reservaId, mudanca, usuario, autorizacao?)` — só em `pre_reserva|confirmada|hospedada` (`hospedada` não pode mudar `chegada`). Recalcula **apenas noites afetadas**: noites novas, ou todas as noites se mudarem categoria/adultos/crianças; noites que permanecem com mesma categoria/ocupação **mantêm o valor congelado**. Trocar só o quarto (mesma categoria) não recalcula nada. Revalida disponibilidade (ignorando a própria reserva) e restrições. Emite `hospedagem.ReservaAlterada`.
  - `cancelarReserva(ctx, reservaId, usuario, autorizacao)` — ação sensível; emite `hospedagem.ReservaCancelada` com `{ motivo, automatico: false }`
  - `marcarNoShow(ctx, reservaId, usuario, autorizacao)` — só `confirmada` com `chegada <` dia hoteleiro atual → `NO_SHOW_ANTECIPADO`
  - `prorrogarSinal(ctx, reservaId, novoPrazo: string /* ISO */, usuario, autorizacao)` — só `pre_reserva`; define `prazo_sinal = novoPrazo`, `aviso_sinal_em = NULL`, resolve alertas de sinal da reserva
  - Rotas: `GET /api/reservas/:id/previa` (query), `PATCH /api/reservas/:id`, `POST /api/reservas/:id/cancelar`, `POST /api/reservas/:id/no-show`, `POST /api/reservas/:id/prorrogar-sinal`

- [ ] **Step 1: Testes que falham**

```ts
test("esticar a saída mantém as noites antigas congeladas e cota só as novas", async () => {
  // reserva 20→23 a 30000/noite; tabela sobe para 40000; saída → 25
  // noites: [30000, 30000, 30000, 40000, 40000]
});
test("trocar de quarto na mesma categoria não altera valores", async () => {});
test("preço manual exige supervisor e aparece no detalhamento", async () => {});
test("Review Focus 5: arrastar sobre outra reserva é rejeitado e a original fica intacta", async () => {
  await expect(alterarReserva(ctx, r1, { quartoId: quartoDaR2 }, recepcao)).rejects.toMatchObject({ codigo: "QUARTO_INDISPONIVEL" });
  expect((await obterReserva(ctx, r1)).quartoId).toBe(quartoOriginal);
});
test("cancelar exige supervisor e motivo", async () => {});
test("no-show antes da data de chegada é rejeitado", async () => {});
test("prorrogar sinal zera o aviso e resolve o alerta", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): alteração, cancelamento, no-show e prorrogação`

---

### Task 11: Conta do hóspede

**Files:**
- Create: `apps/server/src/hospedagem/conta.ts` (rotas em `hospedagem/rotas.ts`)
- Test: `apps/server/test/hospedagem/conta.test.ts`

**Interfaces:**
- Consumes: `exigirCaixaAberto`, `registrarMovimento` (Task 6); produtos (Task 4); reservas (Task 9)
- Produces (interface pública que os subprojetos 2 e 3 vão usar):
  - Tabelas (somente inserção): `lancamentos(id, conta_id, reserva_id NULL, tipo: "diaria" | "extra" | "estorno", origem: string /* "hospedagem", futuramente "bar" */, produto_id NULL, descricao, quantidade, valor /* total, + ou − */, data_ref NULL /* noite, para diárias */, estorna_id NULL, instante, usuario)` com índice único parcial `(reserva_id, data_ref) WHERE tipo='diaria'`; `pagamentos(id, conta_id, reserva_id NULL, forma_codigo, valor /* + ou − */, estorna_id NULL, turno_id, instante, usuario)`
  - `lancar(tx, { contaId; reservaId?; tipo: "diaria" | "extra"; origem; produtoId?; descricao; quantidade; valorUnitario: Centavos; dataRef?: Data }, ator): Promise<string>` → `CONTA_FECHADA`
  - `estornarLancamento(ctx, lancamentoId, usuario, autorizacao)` → `JA_ESTORNADO`
  - `registrarPagamento(ctx, { contaId; reservaId?; formaCodigo; valor: Centavos }, usuario): Promise<string>` — exige caixa aberto do usuário; forma ativa; registra movimento de caixa. Se a reserva estiver em `pre_reserva` e a soma paga ≥ `valor_sinal` → `confirmada` (evento `hospedagem.ReservaConfirmada`). Se a reserva estiver `cancelada` → aceita o pagamento **e** cria alerta `pagamento_reserva_cancelada` (cobre a regra da spec para pagamentos vindos da sincronização).
  - `estornarPagamento(ctx, pagamentoId, usuario, autorizacao)` — movimento negativo no caixa **do usuário que estorna**
  - `saldo(ctx, contaId): Promise<{ debitos: Centavos; creditos: Centavos; saldo: Centavos }>` (saldo = débitos − créditos); `extrato(ctx, contaId): Promise<LinhaExtrato[]>` (ordenado por data, com origem)
  - `pagoNaReserva(ctx, reservaId): Promise<Centavos>`
  - Rotas: `GET /api/contas/:id`, `POST /api/contas/:id/lancamentos`, `POST /api/contas/:id/pagamentos`, `POST /api/lancamentos/:id/estornar`, `POST /api/pagamentos/:id/estornar`

- [ ] **Step 1: Testes que falham**

```ts
test("pagamento do sinal confirma a pré-reserva", async () => {
  await abrirCaixa(ctx, recepcao.id, 0);
  await registrarPagamento(ctx, { contaId: r.contaId, reservaId: r.id, formaCodigo: "pix", valor: 27000 }, recepcao);
  expect((await obterReserva(ctx, r.id)).estado).toBe("confirmada");
});
test("pagamento parcial não confirma", async () => {});
test("estorno gera lançamento negativo e não apaga o original", async () => {
  // extra 5000 → estorno → saldo 0, extrato com 2 linhas; estornar de novo → JA_ESTORNADO
});
test("pagamento sem caixa aberto é rejeitado", async () => {});
test("pagamento em reserva cancelada gera alerta", async () => {});
test("diária duplicada para a mesma noite é rejeitada pelo banco", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): conta do hóspede`

---

### Task 12: Prazo do sinal — aviso e cancelamento automático

**Files:**
- Create: `apps/server/src/hospedagem/sinal.ts`
- Test: `apps/server/test/hospedagem/sinal.test.ts`

**Interfaces:**
- Consumes: `pagoNaReserva` (Task 11), `criarAlerta` (Task 2), config `sinal.toleranciaHoras` (Task 3)
- Produces:
  - `processarSinais(ctx): Promise<{ avisadas: string[]; canceladas: string[] }>` — idempotente; para cada `pre_reserva`:
    - `agora ≥ prazo_sinal` e `aviso_sinal_em` nulo → grava `aviso_sinal_em = agora`, alerta `sinal_vencido`
    - `aviso_sinal_em` + `toleranciaHoras` ≤ agora:
      - `pagoNaReserva = 0` → `cancelada`, ator `ATOR_SISTEMA`, motivo `"sinal não pago"`, evento `hospedagem.ReservaCancelada { automatico: true }`, resolve o alerta `sinal_vencido`
      - `pagoNaReserva > 0` → **não cancela**; alerta `sinal_parcial`

- [ ] **Step 1: Testes que falham**

```ts
test("ciclo completo: aviso no prazo, cancelamento após a tolerância", async () => {
  // reserva criada em T, prazo 48h, tolerância 12h
  ctx.relogio.avancarHoras(47); expect((await processarSinais(ctx)).avisadas).toEqual([]);
  ctx.relogio.avancarHoras(1);  expect((await processarSinais(ctx)).avisadas).toEqual([r.id]);
  ctx.relogio.avancarHoras(11); expect((await processarSinais(ctx)).canceladas).toEqual([]);
  ctx.relogio.avancarHoras(1);  expect((await processarSinais(ctx)).canceladas).toEqual([r.id]);
  const aud = await ctx.db.selectFrom("auditoria").selectAll().where("acao", "=", "reserva.cancelar").executeTakeFirst();
  expect(aud).toMatchObject({ ator: "Sistema", motivo: "sinal não pago" });
});
test("pagamento parcial impede o cancelamento automático e gera alerta", async () => {});
test("rodar duas vezes não duplica aviso nem alerta", async () => {});
test("reserva confirmada nunca é processada", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): prazo do sinal com cancelamento automático`

---

### Task 13: Virada do dia hoteleiro — lançamento das diárias

**Files:**
- Create: `apps/server/src/hospedagem/virada.ts`
- Test: `apps/server/test/hospedagem/virada.test.ts`

**Interfaces:**
- Consumes: `lancar` (Task 11), `diaHoteleiro` (Task 1), `reserva_noites` (Task 9)
- Produces:
  - `lancarDiariasPendentes(tx, reservaId, ate: Data /* exclusiva */): Promise<number>` — lança cada noite congelada `D` com `chegada ≤ D < ate` que ainda não tem lançamento `diaria`; descrição `"Diária DD/MM — <rótulo do último passo>"`; retorna quantas lançou
  - `processarVirada(ctx): Promise<number>` — para cada reserva `hospedada`: `lancarDiariasPendentes(reserva, min(diaHoteleiro(agora), saida))`. Idempotente (índice único + checagem).

- [ ] **Step 1: Testes que falham**

```ts
test("a noite de 20/11 é lançada na virada das 04:00 de 21/11", async () => {
  // hospedada chegada 20, saída 23. relógio 21/11 06:59Z (03:59 local) → 0; 07:00Z → 1 lançamento data_ref 2026-11-20
});
test("Review Focus 3: servidor desligado 3 dias lança as noites faltantes uma única vez", async () => {
  // relógio pula para 24/11 → lança 20, 21, 22 (não 23: saída); rodar de novo → 0
});
test("reserva não hospedada não recebe diária", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): virada do dia hoteleiro`

---

### Task 14: Check-in

**Files:**
- Create: `apps/server/src/hospedagem/checkin.ts` (rotas em `hospedagem/rotas.ts`)
- Test: `apps/server/test/hospedagem/checkin.test.ts`

**Interfaces:**
- Consumes: `pendenciasFnrh` (Task 4), `mudarSituacaoQuarto` (Task 3), `transicionar` (Task 9), `lancar` (Task 11)
- Produces:
  - `sugerirQuartos(ctx, reservaId): Promise<Quarto[]>` — quartos `livre` (limpos) da categoria reservada, disponíveis em todo o período; o já atribuído primeiro
  - `fazerCheckin(ctx, { reservaId; quartoId; acompanhantes: string[] /* hospedeIds */; cobrarEarlyCheckin?: boolean; recalcularPreco?: boolean }, usuario): Promise<void>` — regras:
    - estado `confirmada` → `RESERVA_NAO_CONFIRMADA` caso contrário; dia hoteleiro atual = `chegada` → `CHECKIN_FORA_DA_DATA` (antes ou depois exige alterar a reserva)
    - FNRH completa do titular e acompanhantes (adulto = idade ≥ 18 na chegada) → `FNRH_INCOMPLETA` com `detalhes: { [hospedeId]: string[] }`
    - quarto `livre` e disponível → `QUARTO_INDISPONIVEL`
    - quarto de outra categoria = upgrade: grava `categoria_id` nova e audita `reserva.upgrade`; preço congelado mantido, salvo `recalcularPreco: true` (ação de recálculo via `alterarReserva`)
    - early check-in: se `horaLocal(agora) < config.horaCheckin` e `cobrarEarlyCheckin !== false` → lança extra `EARLY_CHECKIN` (fixo ou % da 1ª diária congelada)
    - efeitos: reserva `hospedada`, quarto `ocupado`, evento `hospedagem.CheckinConcluido { reservaId, quartoId, hospedeIds }` (consumido pela impressão no Plano D)
  - Rotas: `GET /api/reservas/:id/quartos-sugeridos`, `POST /api/reservas/:id/checkin`

- [ ] **Step 1: Testes que falham**

```ts
test("sugere apenas quartos limpos da categoria", async () => { /* 101 livre, 102 sujo, 201 outra categoria → [101] */ });
test("FNRH incompleta bloqueia e diz o que falta", async () => {});
test("check-in fora da data é rejeitado", async () => {});
test("check-in antes do horário lança early check-in; com cobrarEarlyCheckin=false não lança", async () => {});
test("check-in concluído: hospedada, quarto ocupado, evento CheckinConcluido no outbox", async () => {});
test("upgrade mantém o preço congelado e é auditado", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): check-in`

---

### Task 15: Check-out e valores a receber

**Files:**
- Create: `apps/server/src/hospedagem/checkout.ts` (rotas em `hospedagem/rotas.ts`)
- Test: `apps/server/test/hospedagem/checkout.test.ts`

**Interfaces:**
- Consumes: `lancarDiariasPendentes` (Task 13), `saldo`, `registrarPagamento` (Task 11), `mudarSituacaoQuarto` (Task 3)
- Produces:
  - Tabela: `valores_a_receber(id, conta_id, reserva_id, responsavel_nome, responsavel_documento, valor, criado_em, situacao: "aberto")` — consumida pelo Financeiro (subprojeto 5)
  - `previaCheckout(ctx, reservaId): Promise<{ extrato: LinhaExtrato[]; saldo: Centavos; lateCheckout?: Centavos; saidaAntecipada: boolean }>`
  - `fazerCheckout(ctx, { reservaId; pagamentos: { formaCodigo: string; valor: Centavos }[]; faturado?: { nome: string; documento: string; valor: Centavos }; cobrarLateCheckout?: boolean }, usuario): Promise<void>` — numa transação:
    1. data efetiva de saída = dia hoteleiro atual. Se < `saida` (saída antecipada): apaga de `reserva_noites` as noites ≥ data efetiva (não financeiras — ainda não lançadas) e atualiza `saida`
    2. `lancarDiariasPendentes(reserva, saidaEfetiva)`
    3. late checkout: `horaLocal(agora) > config.horaCheckout` e `cobrarLateCheckout !== false` → extra `LATE_CHECKOUT`
    4. registra os pagamentos; `faturado` → pagamento com forma `faturado` + linha em `valores_a_receber` (evento `hospedagem.ValorAReceberCriado`)
    5. conta individual: saldo ≠ 0 → `SALDO_PENDENTE` (com `detalhes.saldo`) e **nada** é gravado. Conta de grupo `unica`: exige saldo zero apenas quando esta é a última reserva não finalizada do grupo
    6. reserva `finalizada`; quarto `sujo`; conta `fechada` (se for a última); evento `hospedagem.CheckoutConcluido`
  - Rotas: `GET /api/reservas/:id/checkout`, `POST /api/reservas/:id/checkout`

- [ ] **Step 1: Testes que falham**

```ts
test("pagamento dividido zera o saldo e finaliza", async () => {
  // 3 noites de 30000 + extra 5000 = 95000; pix 50000 + credito 45000 → finalizada, quarto sujo, conta fechada
});
test("saldo pendente impede o check-out sem gravar nada", async () => {
  // pagamento insuficiente → SALDO_PENDENTE; reserva continua hospedada; nenhum pagamento gravado
});
test("faturado gera valor a receber", async () => {});
test("Review Focus 4: saída antecipada cobra só as noites usadas", async () => {
  // reserva 20→25, checkout no dia hoteleiro 22 → diárias lançadas só de 20 e 21; saída da reserva = 22
});
test("late checkout após o horário", async () => {});
test("grupo com conta única: só o último quarto exige saldo zero", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): check-out e valores a receber`

---

### Task 16: Governança

**Files:**
- Create: `apps/server/src/hospedagem/governanca.ts` (rotas em `hospedagem/rotas.ts`)
- Test: `apps/server/test/hospedagem/governanca.test.ts`

**Interfaces:**
- Consumes: `mudarSituacaoQuarto`, `listarQuartos` (Task 3)
- Produces:
  - `listaGovernanca(ctx): Promise<{ quartoId; numero; situacao; hospedadoAte?: Data }[]>` — ordenada: sujos primeiro, depois por número
  - `marcarLimpo(ctx, quartoId, usuario)` — `sujo → livre`; exige `quartos.situacao`
  - `colocarEmManutencao(ctx, quartoId, motivo, usuario)` / `bloquear(...)` / `liberar(...)` — exigem `quartos.manutencao` e motivo; quarto com reserva `hospedada` → `QUARTO_OCUPADO`
  - Rotas: `GET /api/governanca`, `POST /api/quartos/:id/limpo`, `POST /api/quartos/:id/manutencao`, `POST /api/quartos/:id/bloquear`, `POST /api/quartos/:id/liberar`

- [ ] **Step 1: Testes que falham**

```ts
test("governança marca limpo, mas não coloca em manutenção (403)", async () => {});
test("manutenção exige motivo", async () => {});
test("lista traz sujos primeiro", async () => {});
test("quarto em manutenção some da disponibilidade", async () => { /* criarReserva no quarto → QUARTO_INDISPONIVEL */ });
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): governança`

---

### Task 17: Consultas — mapa de ocupação, painel do dia e busca universal

**Files:**
- Create: `apps/server/src/hospedagem/consultas.ts` (rotas em `hospedagem/rotas.ts`)
- Test: `apps/server/test/hospedagem/consultas.test.ts`

**Interfaces:**
- Produces:
  - `mapaOcupacao(ctx, { inicio: Data; fim: Data; categoriaId?: string }): Promise<{ quartos: { id; numero; categoria; situacao }[]; barras: { reservaId; codigo; quartoId: string | null; categoriaId; chegada; saida; estado; titular }[] }>` — barras de reservas em `pre_reserva|confirmada|hospedada|finalizada` que tocam o período; sem quarto → `quartoId: null` (a interface exibe na linha "sem quarto" da categoria)
  - `painelDoDia(ctx): Promise<{ dia: Data; chegadas; saidas; hospedados: number; quartosSujos; sinaisVencendo /* prazo nas próximas 24h */; chegadasVencidas /* confirmadas com chegada < dia */; alertas }>`
  - `buscaUniversal(ctx, q: string): Promise<{ tipo: "quarto" | "hospede" | "reserva"; id; rotulo; acoes: string[] }[]>` — dígitos curtos (≤ 4) casam número de quarto e código de reserva; 11 dígitos casam CPF; texto casa nome de hóspede; no máximo 10 resultados
  - `historicoEstadias(ctx, hospedeId)` — reservas finalizadas do hóspede
  - Rotas: `GET /api/mapa?inicio&fim&categoriaId`, `GET /api/painel`, `GET /api/busca?q=`, `GET /api/hospedes/:id/historico`

- [ ] **Step 1: Testes que falham**

```ts
test("mapa inclui reservas que tocam o período e reservas sem quarto", async () => {});
test("painel do dia lista chegadas, saídas, sujos, sinais vencendo e chegadas vencidas", async () => {});
test("busca '12' encontra o quarto 12 e a reserva de código 12", async () => {});
test("busca por CPF formatado encontra o hóspede", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(hospedagem): mapa, painel do dia e busca`

---

### Task 18: Executável do servidor, agendador e fluxo ponta a ponta

**Files:**
- Create: `apps/server/src/{main,agendador,config}.ts`
- Test: `apps/server/test/e2e/fluxo-completo.test.ts`

**Interfaces:**
- Consumes: tudo acima
- Produces:
  - `config.ts`: lê `ERP_DB` (padrão `./dados/erp.db`), `ERP_PORTA` (padrão `8080`), `ERP_HOST` (padrão `0.0.0.0`, para a rede interna)
  - `iniciarAgendador(ctx, intervaloMs = 60_000): () => void` — a cada intervalo roda `processarSinais` e `processarVirada`; erro em um job é logado e não derruba o outro nem o servidor; retorna função de parada
  - `main.ts`: abre banco, roda todas as migrações (infra, nucleo, tarifas, hospedagem), cria app, inicia agendador, escuta; encerra limpo em `SIGINT`/`SIGTERM`
  - Script `"start": "tsx src/main.ts"` (empacotamento em executável fica para o Plano D)

- [ ] **Step 1: Teste ponta a ponta que falha** (via `app.inject`, só HTTP):

```ts
test("fluxo completo de uma estadia", async () => {
  // login admin → cria categoria, quarto 12, tabela base → cria hóspede completo
  // → POST /api/reservas (pre_reserva) → abre caixa → pagamento do sinal (confirmada)
  // → relógio no dia de chegada 15:00 local → check-in → relógio +1 dia 07:00Z → agendador.tick()
  // → GET conta: 1 diária → checkout pagando o saldo → 200
  // asserts: reserva finalizada; quarto 12 "sujo"; outbox contém, em ordem, ReservaCriada, ReservaConfirmada,
  //          CheckinConcluido, CheckoutConcluido; fechar caixa: diferença 0
});
test("agendador: erro num job não impede o outro", async () => {});
```

- [ ] **Step 2: Rodar e ver falhar.** - [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar a suíte inteira** — `npm test -w apps/server` → todos PASS; `npm run typecheck -w apps/server` → sem erros.
- [ ] **Step 5: Teste manual rápido** — `npm start -w apps/server` e `curl -X POST localhost:8080/api/sessoes -H "content-type: application/json" -d "{\"login\":\"admin\",\"senha\":\"admin\"}"` → 200 com `token`.
- [ ] **Step 6: Commit** — `feat: servidor local executável com agendador e teste ponta a ponta`
