# Plano B1 — Interface de operação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a interface web de operação (recepção e governança) servida pelo servidor local, com os ajustes de API que ela exige e uma pousada de demonstração.

**Architecture:** Novo pacote `apps/web` (React + Vite + TypeScript) no monorepo. A interface conversa com a API existente via um cliente `fetch` único e TanStack Query; os tipos de dados são importados como `import type` do código do servidor (fonte única). O servidor passa a servir o build estático em `/` com fallback de SPA. Componentes visuais próprios com CSS de variáveis (tokens do estilo acolhedor).

**Tech Stack:** React 19, React Router 7, TanStack Query 5, Vite 7, TypeScript 5.9, Vitest 3 + jsdom + Testing Library 16 + user-event 14, Playwright (`@playwright/test`), `@fastify/static` 8 no servidor.

**Spec:** `docs/superpowers/specs/2026-10-23-plano-b1-interface-design.md` (base: `2026-10-22-nucleo-hospedagem-design.md`). Decisões e pendências do Plano A: `docs/superpowers/plans/2026-10-22-plano-a-decisoes-e-pendencias.md`.

## Global Constraints

- Todo texto visível em português do Brasil. Mensagens de erro da API (`mensagem`) exibidas como vieram, junto da ação que falhou.
- Cores somente via variáveis CSS dos tokens (spec seção 2): `--fundo #faf6ef`, `--superficie #fffdf8`, `--borda #eadfcd`, `--texto #3b2f25`, `--texto-suave #8a7663`, `--verde #2f6f5e`, `--terracota #c0613a`, `--amarelo #f2c879`, `--alerta-fundo #fbeee6`. Fonte `system-ui, "Segoe UI", sans-serif`; nenhuma fonte ou CDN externa.
- Dinheiro trafega e é guardado em **centavos inteiros**; exibido como `R$ 1.234,56`; digitado em reais com vírgula.
- Datas trafegam como `YYYY-MM-DD`; exibidas `DD/MM` ou `DD/MM/AAAA`. O "dia de hoje" da operação vem do servidor (`painel.dia`), nunca do relógio do navegador.
- Sessão: token Bearer guardado em `localStorage` na chave `erp.token`; 401 → login, retornando à rota anterior.
- Ações sensíveis enviam `{ motivo, supervisor: { login, senha } }`.
- Elementos interativos acessíveis (rótulos e papéis), pois os testes usam `getByRole`/`getByLabelText`.
- Sem biblioteca de componentes visuais e sem biblioteca de arrastar-e-soltar.
- Servidor: mesmas regras do Plano A (centavos, `ctx.relogio`, insert-only financeiro, migrações com prefixo numérico).

## Review Focus

1. **Duas recepcionistas em PCs diferentes:** check-out feito no PC 1 deve aparecer no mapa do PC 2 em até ~30 s sem recarregar. (Teste na Task 5: o cliente refaz consultas por intervalo e invalida após mutações.)
2. **Valor digitado com centavos e milhar ("1.234,5")** → 123450 centavos; "abc" ou vazio → campo inválido, nunca `NaN` enviado. (Teste na Task 4.)
3. **Arrastar e soltar no mesmo lugar** ou soltar fora da grade → nenhuma chamada à API e nenhuma janela de confirmação. (Teste na Task 9.)
4. **Erro da API no meio do check-out (ex.: `SALDO_PENDENTE`)** → painel continua aberto com os valores digitados e a mensagem do servidor visível. (Teste na Task 13.)
5. **Servidor da pousada desligado** → faixa "Sem conexão com o servidor da pousada" e botões de ação desabilitados; volta sozinho. (Teste na Task 6.)

---

## Estrutura de arquivos

```
apps/server/src/
  hospedagem/lista-reservas.ts       (Task 1)
  hospedagem/consultas.ts            (Task 2, ampliar painel)
  http/estaticos.ts                  (Task 3)
  demo.ts                            (Task 3)
apps/web/
  package.json  tsconfig.json  vite.config.ts  index.html  playwright.config.ts
  public/manifest.webmanifest  public/icone.svg
  src/
    main.tsx  App.tsx  rotas.tsx
    estilo/tokens.css  estilo/base.css
    api/cliente.ts  api/tipos.ts  api/consultas.ts
    lib/dinheiro.ts  lib/datas.ts
    auth/SessaoProvider.tsx  auth/Login.tsx  auth/TrocarSenha.tsx  auth/RotaProtegida.tsx
    layout/Shell.tsx  layout/MenuLateral.tsx  layout/BarraTopo.tsx  layout/FaixaConexao.tsx
    componentes/Botao.tsx  Cartao.tsx  Etiqueta.tsx  CampoDinheiro.tsx  Gaveta.tsx  ErroAcao.tsx  JanelaSupervisor.tsx  Janela.tsx
    telas/hoje/  telas/mapa/  telas/reserva/  telas/nova-reserva/  telas/reservas/  telas/caixa/  telas/governanca/  telas/busca/
  test/ajuda.tsx  test/api-falsa.ts
  e2e/recepcao.spec.ts
```

---

### Task 1: Servidor — lista de reservas, canais para leitura e caixa atual com movimentos

**Files:**
- Create: `apps/server/src/hospedagem/lista-reservas.ts`
- Modify: `apps/server/src/hospedagem/rotas.ts`, `apps/server/src/tarifas/rotas.ts:77`, `apps/server/src/nucleo/caixa.ts`, `apps/server/src/nucleo/rotas.ts:156-159`
- Test: `apps/server/test/hospedagem/lista-reservas.test.ts`, `apps/server/test/nucleo/caixa.test.ts`

**Interfaces:**
- Produces:
  - `listarReservas(ctx, f: { inicio?: Data; fim?: Data; estados?: EstadoReserva[]; canal?: string; q?: string; pagina?: number; porPagina?: number }): Promise<{ itens: ItemListaReserva[]; total: number }>` — período por sobreposição (`chegada <= fim AND saida > inicio`); `q` casa nome do titular (normalizado, sem acento) ou `codigo` exato quando só dígitos; ordem `chegada` desc, depois `codigo` desc; `porPagina` padrão 50, máx 100; `pagina` começa em 1.
  - `type ItemListaReserva = ItemReserva & { estado: EstadoReserva; canal: string; categoria: string; total: Centavos }` (`ItemReserva` de `consultas.ts`; `total` = soma de `reserva_noites`).
  - `GET /api/reservas?inicio&fim&estado=a,b&canal&q&pagina&porPagina` — exige `reservas.gerenciar`; datas pelo schema `data` de `http/validacao.ts`.
  - `GET /api/tarifas/canais` passa a exigir só sessão (leitura); `PUT` continua com `tarifas.gerenciar`.
  - `resumoCaixa(ctx, usuarioId): Promise<{ turno: Turno; movimentos: { forma: string; valor: Centavos; origemTipo: string; instante: string }[]; esperadoPorForma: Record<string, Centavos> } | null>` em `caixa.ts` (esperado de `dinheiro` inclui `valorInicial`); `GET /api/caixa/atual` passa a devolver `resumoCaixa`.

- [ ] **Step 1: Testes que falham**

```ts
test("filtra por período, estado e texto, com paginação", async () => {
  // 3 reservas: Maria 20→23 confirmada, João 25→27 pre_reserva, Ana 01/12→03/12 cancelada
  const r = await listarReservas(ctx, { inicio: "2026-11-21", fim: "2026-11-30", estados: ["confirmada", "pre_reserva"] });
  expect(r.itens.map(i => i.titular)).toEqual(["João Pereira", "Maria Silva"]);
  expect(r.total).toBe(2);
  expect((await listarReservas(ctx, { q: "joao" })).itens[0].titular).toBe("João Pereira");
  expect((await listarReservas(ctx, { porPagina: 1, pagina: 2 })).itens).toHaveLength(1);
});
test("item traz total da estadia e categoria", async () => { /* total 90000, categoria "Standard" */ });
test("GET /api/reservas exige reservas.gerenciar e valida datas", async () => { /* governanca 403; inicio=2026-02-30 → 400 */ });
test("canais podem ser lidos pela recepção, mas não alterados", async () => { /* GET 200, PUT 403 */ });
test("caixa atual traz movimentos e esperado por forma", async () => {
  // abrir 10000, pagamento pix 27000 → esperadoPorForma { dinheiro: 10000, pix: 27000 }, movimentos.length 1
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run test/hospedagem/lista-reservas.test.ts test/nucleo/caixa.test.ts` → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces; ajustar testes existentes de `GET /api/caixa/atual` ao novo formato.
- [ ] **Step 4: Rodar** a suíte do servidor + typecheck → PASS.
- [ ] **Step 5: Commit** — `feat(api): lista de reservas, canais para leitura e resumo do caixa`

---

### Task 2: Servidor — painel do dia ampliado com fila de atenção

**Files:**
- Modify: `apps/server/src/hospedagem/consultas.ts`
- Test: `apps/server/test/hospedagem/consultas.test.ts`

**Interfaces:**
- Produces (amplia `Painel`, mantendo os campos atuais para não quebrar consumidores):
  - `Painel.ocupacao: { ocupados: number; total: number; percentual: number }` — `total` = quartos fora de `em_manutencao|bloqueado`; `ocupados` = reservas `pre_reserva|confirmada|hospedada` cobrindo a noite `dia`; `percentual` arredondado.
  - `Painel.numeros: { chegadas; chegadasJaHospedadas; saidas; hospedados; pessoasHospedadas; quartosSujos; quartosManutencao; livresHoje }` — `chegadasJaHospedadas` = reservas `hospedada` com `chegada = dia`; `pessoasHospedadas` = adultos + crianças das `hospedada`; `livresHoje = total − ocupados` (mínimo 0).
  - `Painel.chegadas: ItemChegada[]` onde `ItemChegada = ItemReserva & { estado; noites; adultos; criancas: number; canal; sinalPendente: Centavos /* max(0, valor_sinal − pago) */; pendenciasFnrh: boolean /* titular com pendências */ }`; inclui as já `hospedada` com `chegada = dia`.
  - `Painel.saidas: ItemSaida[]` onde `ItemSaida = ItemReserva & { contaId: string; saldo: Centavos }`.
  - `Painel.governanca: { quartoId; numero; situacao: "sujo" | "em_manutencao" | "bloqueado"; motivo: string | null }[]` — motivo = o da última auditoria `quarto.situacao` do quarto.
  - `Painel.proximosDias: { dia: Data; chegadas: number; saidas: number; ocupacaoPct: number }[]` — exatamente `dia+1` e `dia+2`.
  - `Painel.atencao: ItemAtencao[]` — fila genérica (preparação para S&R via WhatsApp):
    `type ItemAtencao = { tipo: "sinal_vencendo" | "chegada_atrasada" | "alerta"; id: string; titulo: string; detalhe: string; reservaId: string | null; contaId: string | null; telefone: string | null; acoes: ("registrar_sinal" | "prorrogar_sinal" | "marcar_no_show" | "abrir_reserva" | "abrir_conta" | "resolver_alerta")[] }`
    Ordem: `sinal_vencendo` (prazo mais próximo primeiro), `chegada_atrasada`, `alerta` (mais antigo primeiro). Títulos: "Sinal vence às HH:MM" (hora local; "Sinal vence amanhã às HH:MM" se for outro dia), "Chegada atrasada", e para alertas a `mensagem` do alerta.
  - `POST /api/alertas/:id/resolver` (sessão + `reservas.gerenciar`) usando `resolverAlerta`.

- [ ] **Step 1: Testes que falham**

```ts
test("ocupação e números do dia", async () => {
  // 10 quartos, 1 em manutenção; 6 reservas cobrindo o dia (4 hospedadas com 9 pessoas)
  const p = await painelDoDia(ctx);
  expect(p.ocupacao).toEqual({ ocupados: 6, total: 9, percentual: 67 });
  expect(p.numeros).toMatchObject({ hospedados: 4, pessoasHospedadas: 9, quartosManutencao: 1, livresHoje: 3 });
});
test("chegada mostra sinal pendente e pendência de FNRH", async () => { /* pre_reserva sinal 27000 pago 10000 → sinalPendente 17000; titular sem documento → pendenciasFnrh true */ });
test("saída mostra saldo da conta", async () => {});
test("fila de atenção: sinal antes de chegada atrasada antes de alerta, com ações", async () => {
  const p = await painelDoDia(ctx);
  expect(p.atencao.map(a => a.tipo)).toEqual(["sinal_vencendo", "chegada_atrasada", "alerta"]);
  expect(p.atencao[0].acoes).toEqual(["registrar_sinal", "prorrogar_sinal"]);
  expect(p.atencao[1]).toMatchObject({ acoes: ["marcar_no_show", "abrir_reserva"], telefone: "(48) 99812-3344" });
});
test("governança traz motivo da manutenção", async () => {});
test("próximos dias: exatamente dois", async () => {});
test("resolver alerta pela API", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar (reutilizar `pagoNaReserva`, `saldo`, `pendenciasFnrh`) → PASS (suíte do servidor + typecheck).
- [ ] **Step 5: Commit** — `feat(api): painel do dia ampliado com fila de atenção`

---

### Task 3: Servidor — arquivos estáticos da interface e pousada de demonstração

**Files:**
- Create: `apps/server/src/http/estaticos.ts`, `apps/server/src/demo.ts`
- Modify: `apps/server/src/main.ts`, `apps/server/src/config.ts`, `apps/server/package.json` (dependência `@fastify/static@^8`, script `"demo": "tsx src/demo.ts"`)
- Test: `apps/server/test/http/estaticos.test.ts`, `apps/server/test/demo.test.ts`

**Interfaces:**
- Produces:
  - `config.webDir`: env `ERP_WEB_DIR`, padrão `path.resolve(<dir de main.ts>, "../../web/dist")`.
  - `registrarEstaticos(app, webDir: string): void` — se `webDir/index.html` existir, serve os arquivos em `/`; GET que não seja `/api/*` e não exista como arquivo devolve `index.html` (200, `text/html`); `/api/*` inexistente continua 404 JSON. Se o diretório não existir, não registra nada (servidor só de API).
  - `semearDemonstracao(ctx: Contexto): Promise<{ quartos: number; reservas: number }>` — recusa com `ErroDominio("BASE_NAO_VAZIA")` se já houver quartos. Cria, relativo a `diaHoteleiro(agora)` = H:
    - config: razão social "Pousada Sol (demonstração)"; sinal 30%, prazo 48h, tolerância 12h.
    - categorias: Standard (101–106, 2 adultos/1 criança, base {1: 22000, 2: 28000, 3: 34000}, extra 8000), Superior (201–204, 3/2, {1: 30000, 2: 38000, 3: 46000}, 10000), Chalé (301–302, 4/2, {1: 45000, 2: 52000, 3: 60000}, 12000).
    - temporada "Alta" +20% de H+20 a H+40, prioridade 1; canais Balcão (0%) e Site (−5%, exige sinal); dia da semana sexta e sábado +15%.
    - usuários: `admin`/`admin` (já existe, mantém `trocarSenha`), `recepcao`/`recepcao123` (perfil recepcao, `trocarSenha` falso), `governanca`/`governanca123`.
    - 15 hóspedes com CPFs válidos e dados de FNRH completos (um deles sem documento, para mostrar pendência).
    - reservas: 4 hospedadas (chegadas H−2/H−1, uma saindo hoje com extra de frigobar), 3 chegadas hoje confirmadas (uma sem quarto), 1 pré-reserva com prazo de sinal em agora+6h, 1 confirmada com chegada ontem (atrasada, titular com telefone), 1 grupo conta única com 2 quartos chegando H+1, e 6 reservas futuras espalhadas até H+30.
    - quartos: 103 `sujo`; 106 `em_manutencao` com motivo "chuveiro".
    - Para criar hospedadas e a saída de hoje, a semeadura pode gravar estados e diárias pelos serviços (check-in com relógio ajustado) ou diretamente nas tabelas, desde que o resultado seja consistente (conta, diárias lançadas das noites passadas, quarto `ocupado`).
    - caixa: nenhum turno aberto.
  - `src/demo.ts`: abre `config.banco`, migra, roda `semearDemonstracao` com `relogioSistema`, imprime resumo e os logins; código de saída 1 com mensagem em português se a base não estiver vazia.

- [ ] **Step 1: Testes que falham**

```ts
test("serve index.html em rotas da interface e mantém 404 JSON na API", async () => {
  // webDir temporário com index.html "<h1>ERP</h1>" e assets/app.js
  expect((await app.inject("/")).body).toContain("ERP");
  expect((await app.inject("/mapa")).headers["content-type"]).toMatch(/text\/html/);
  expect((await app.inject("/assets/app.js")).statusCode).toBe(200);
  const api = await app.inject("/api/inexistente");
  expect(api.statusCode).toBe(401); // rota da API continua sob autenticação, não vira index.html
});
test("sem build da interface, servidor segue só com a API", async () => {});
test("demonstração povoa a pousada relativa ao dia", async () => {
  const r = await semearDemonstracao(ctx);
  expect(r.quartos).toBe(12);
  const p = await painelDoDia(ctx);
  expect(p.chegadas.length).toBeGreaterThanOrEqual(3);
  expect(p.atencao.some(a => a.tipo === "sinal_vencendo")).toBe(true);
  expect(p.atencao.some(a => a.tipo === "chegada_atrasada")).toBe(true);
});
test("demonstração recusa base com dados", async () => { /* segunda chamada → BASE_NAO_VAZIA */ });
```

- [ ] **Step 2–4:** falhar → implementar → PASS (suíte do servidor + typecheck).
- [ ] **Step 5: Verificação manual** — `ERP_DB=./dados/demo.db npm run demo -w apps/server` imprime o resumo; rodar de novo imprime a recusa; apagar `dados/demo.db`.
- [ ] **Step 6: Commit** — `feat(server): servir interface e pousada de demonstração`

---

### Task 4: Web — projeto, estilo, cliente da API e formatação

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html}`, `apps/web/src/{main.tsx,App.tsx}`, `apps/web/src/estilo/{tokens.css,base.css}`, `apps/web/src/api/{cliente.ts,tipos.ts}`, `apps/web/src/lib/{dinheiro.ts,datas.ts}`, `apps/web/test/{ajuda.tsx,api-falsa.ts}`
- Test: `apps/web/test/lib/dinheiro.test.ts`, `apps/web/test/lib/datas.test.ts`, `apps/web/test/api/cliente.test.ts`

**Interfaces:**
- Produces:
  - `package.json` (`@erp-hotelaria/web`): deps `react@^19`, `react-dom@^19`, `react-router@^7`, `@tanstack/react-query@^5`; dev `vite@^7`, `@vitejs/plugin-react@^5`, `typescript@^5.9`, `vitest@^3`, `jsdom@^26`, `@testing-library/react@^16`, `@testing-library/user-event@^14`, `@testing-library/jest-dom@^6`, `@types/react@^19`, `@types/react-dom@^19`. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `typecheck`.
  - `vite.config.ts`: proxy `/api` → `http://localhost:8080`; vitest com `environment: "jsdom"` e setup que importa `@testing-library/jest-dom`.
  - `tsconfig.json`: alias `@server/*` → `../server/src/*` usado **somente** com `import type`.
  - `api/tipos.ts`: reexporta como `import type` os tipos do servidor usados pela interface (`Painel`, `ItemAtencao`, `Mapa`, `Barra`, `ReservaDetalhe`, `ItemListaReserva`, `Cotacao`, `ResultadoBusca`, `UsuarioSessao`, `Quarto`, `Categoria`, `Hospede`, `FormaPagamento`, `Produto`, `LinhaExtrato`) e declara `type ErroApiDados = { codigo: string; mensagem: string; detalhes?: unknown }`.
  - `api/cliente.ts`:
    - `class ErroApi extends Error { status: number; codigo: string; detalhes?: unknown }` (mensagem = `mensagem` da API; para falha de rede: `status 0`, `codigo "SEM_CONEXAO"`, mensagem "Sem conexão com o servidor da pousada.")
    - `chamarApi<T>(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", caminho: string, corpo?: unknown): Promise<T>` — Bearer de `localStorage["erp.token"]`; JSON; lança `ErroApi`; em 401 dispara o evento `window` `"erp:sessao-expirada"`.
    - `definirToken(token: string | null): void`.
  - `lib/dinheiro.ts`: `formatarReais(c: number): string` ("R$ 1.234,56", negativos "−R$ 12,00"); `lerReais(texto: string): number | null` (aceita "1234", "1.234,5", "1234,56", "R$ 12,00"; devolve centavos inteiros; inválido/vazio → `null`).
  - `lib/datas.ts`: `formatarData(d: string, comAno?: boolean): string` ("20/11" ou "20/11/2026"); `somarDiasIso(d, n)`; `diasEntre(a, b)`; `nomeDiaSemana(d)` ("Quinta-feira").
  - `test/api-falsa.ts`: `instalarApiFalsa(rotas: Record<string, unknown | ((corpo: any, url: URL) => unknown)>)` substitui `fetch` global; chave `"GET /api/painel"`; valor pode ser `{ __status: 422, codigo, mensagem }` para simular erro; registra chamadas em `chamadas: { metodo; caminho; corpo }[]`.
  - `test/ajuda.tsx`: `renderizar(ui, { rota?: string; usuario?: Partial<UsuarioSessao> })` com QueryClient sem retry, MemoryRouter e sessão falsa.
  - `estilo/tokens.css`: as variáveis da spec seção 2, além de `--raio-cartao: 14px`, `--raio-controle: 10px`; `base.css`: reset, `body` com `--fundo`, fonte do sistema.

- [ ] **Step 1: Testes que falham**

```ts
test("Review Focus 2: lerReais", () => {
  expect(lerReais("1.234,5")).toBe(123450);
  expect(lerReais("1234,56")).toBe(123456);
  expect(lerReais("R$ 12,00")).toBe(1200);
  expect(lerReais("86")).toBe(8600);
  expect(lerReais("abc")).toBeNull();
  expect(lerReais("")).toBeNull();
  expect(lerReais("12,345")).toBeNull();
});
test("formatarReais", () => { expect(formatarReais(123456)).toBe("R$ 1.234,56"); expect(formatarReais(-1200)).toBe("−R$ 12,00"); });
test("datas", () => { expect(formatarData("2026-11-20")).toBe("20/11"); expect(nomeDiaSemana("2026-11-20")).toBe("Sexta-feira"); });
test("cliente: erro da API vira ErroApi com mensagem do servidor", async () => {
  instalarApiFalsa({ "POST /api/reservas": { __status: 422, codigo: "QUARTO_INDISPONIVEL", mensagem: "O quarto 12 já está reservado." } });
  await expect(chamarApi("POST", "/api/reservas", {})).rejects.toMatchObject({ status: 422, codigo: "QUARTO_INDISPONIVEL", message: "O quarto 12 já está reservado." });
});
test("cliente: falha de rede vira SEM_CONEXAO", async () => {});
test("cliente: 401 dispara erp:sessao-expirada", async () => {});
test("cliente: envia Bearer do localStorage", async () => {});
```

(Note: 2026-11-20 é sexta-feira.)

- [ ] **Step 2: Rodar e ver falhar** — `npm test -w apps/web` → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces; `App.tsx` provisório renderiza "ERP Hotelaria".
- [ ] **Step 4: Rodar** — `npm test -w apps/web` e `npm run build -w apps/web` → PASS, `apps/web/dist/index.html` gerado.
- [ ] **Step 5: Commit** — `feat(web): projeto da interface, estilo, cliente da API e formatação`

---

### Task 5: Web — sessão, login, troca de senha, rotas e atualização automática

**Files:**
- Create: `apps/web/src/auth/{SessaoProvider,Login,TrocarSenha,RotaProtegida}.tsx`, `apps/web/src/rotas.tsx`, `apps/web/src/api/consultas.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`
- Test: `apps/web/test/auth/login.test.tsx`, `apps/web/test/api/consultas.test.tsx`

**Interfaces:**
- Consumes: `chamarApi`, `definirToken`, `ErroApi` (Task 4)
- Produces:
  - `useSessao(): { usuario: UsuarioSessao | null; entrar(login, senha): Promise<void>; sair(): Promise<void>; trocarSenha(atual, nova): Promise<void>; pode(permissao: string): boolean }` — `entrar` chama `POST /api/sessoes`, guarda token e usuário (`localStorage["erp.usuario"]` JSON); ao receber o evento `"erp:sessao-expirada"` limpa a sessão.
  - Rotas (`rotas.tsx`): `/login`, `/trocar-senha`, e dentro de `RotaProtegida` + `Shell` (Task 6): `/` (Hoje), `/mapa`, `/reservas`, `/reservas/nova`, `/caixa`, `/governanca`. Rota inicial após login: `/governanca` se o perfil só tiver `quartos.situacao`, senão `/`. `RotaProtegida` redireciona para `/login?voltar=<rota>` sem sessão e para `/trocar-senha` quando `usuario.trocarSenha`.
  - `api/consultas.ts` — QueryClient com `refetchInterval: 30_000`, `refetchOnWindowFocus: true`, `retry` 1 (0 para `ErroApi` com status 4xx); chaves: `["painel"]`, `["mapa", inicio, fim, categoriaId]`, `["reserva", id]`, `["conta", id]`, `["reservas", filtros]`, `["caixa"]`, `["governanca"]`, `["busca", q]`; hooks `usePainel()`, `useMapa(p)`, `useReserva(id)`, `useConta(id)`, `useReservas(f)`, `useCaixa()`, `useGovernanca()`, `useBusca(q)`, e `useAcao<TCorpo, TResp>(fn)` = `useMutation` que após sucesso invalida `painel`, `mapa`, `reserva`, `conta`, `reservas`, `caixa`, `governanca`.

- [ ] **Step 1: Testes que falham**

```tsx
test("login com sucesso leva à tela Hoje", async () => { /* instalarApiFalsa POST /api/sessoes → { token, usuario: recepcao }; digitar; clicar "Entrar"; espera rota "/" */ });
test("login inválido mostra a mensagem do servidor", async () => { /* 422 CREDENCIAIS_INVALIDAS "Login ou senha incorretos." visível */ });
test("admin com trocarSenha é obrigado a trocar antes de entrar", async () => {
  /* login admin com trocarSenha true → tela "Trocar senha"; nova senha curta → mensagem; PUT /api/usuarios/me/senha ok → "/" */
});
test("governança cai direto na tela Governança", async () => {});
test("sessão expirada volta ao login e retorna à rota anterior", async () => { /* em /mapa, evento erp:sessao-expirada → /login?voltar=%2Fmapa; após login → /mapa */ });
test("Review Focus 1: ação invalida painel e mapa; consultas refazem por intervalo", async () => {
  /* useAcao sucesso → chamadas GET /api/painel e GET /api/mapa novamente; refetchInterval configurado em 30000 */
});
```

- [ ] **Step 2–4:** falhar → implementar → PASS (`npm test -w apps/web`).
- [ ] **Step 5: Commit** — `feat(web): sessão, login, troca de senha e rotas`

---

### Task 6: Web — casca: menu lateral, barra de topo e faixa de conexão

**Files:**
- Create: `apps/web/src/layout/{Shell,MenuLateral,BarraTopo,FaixaConexao}.tsx`, `apps/web/src/componentes/{Botao,Cartao,Etiqueta,ErroAcao,Gaveta,Janela,JanelaSupervisor,CampoDinheiro}.tsx`
- Test: `apps/web/test/layout/shell.test.tsx`, `apps/web/test/componentes/componentes.test.tsx`

**Interfaces:**
- Produces:
  - `MenuLateral`: itens Hoje (`/`, permissão `reservas.gerenciar`), Mapa (`/mapa`, `reservas.gerenciar`), Reservas (`/reservas`, `reservas.gerenciar`), Caixa (`/caixa`, `caixa.operar`), Governança (`/governanca`, `quartos.situacao`); só mostra os permitidos; item ativo destacado; rodapé com nome e perfil do usuário e "Sair". Item Hoje mostra contador = `painel.atencao.length` quando > 0.
  - `BarraTopo`: gatilho da busca (texto "Buscar quarto, hóspede, CPF ou nº da reserva… (Ctrl+K)") que abre a busca (Task 16 liga o conteúdo; aqui abre uma `Janela` vazia), indicador de conexão ("Online" verde / "Sem conexão" terracota) e botão "+ Nova reserva" (`/reservas/nova`, só com `reservas.gerenciar`).
  - `useConexao(): { online: boolean }` — `false` quando a última consulta falhou com `SEM_CONEXAO`; volta a `true` no próximo sucesso. `FaixaConexao` mostra "Sem conexão com o servidor da pousada — tentando novamente…" quando offline.
  - `Botao` (`variante: "principal" | "secundario" | "contorno"`, `tamanho: "normal" | "pequeno"`) fica `disabled` quando offline (lê `useConexao`) a menos que `ignorarConexao`.
  - `ErroAcao({ erro })`: mostra `erro.message` com `role="alert"`.
  - `Gaveta({ aberta, aoFechar, titulo, children })`: painel à direita, 44% da largura (mín. 420 px; tela cheia abaixo de 900 px), fecha com Esc.
  - `Janela({ aberta, aoFechar, titulo, children })`: modal centralizado, `role="dialog"`, Esc fecha.
  - `JanelaSupervisor({ aberta, titulo, aoCancelar, aoConfirmar: (a: { motivo: string; supervisor: { login: string; senha: string } }) => Promise<void> })`: campos Motivo, Login do supervisor, Senha; botão Autorizar; mostra `ErroAcao` se `aoConfirmar` lançar; motivo obrigatório antes de enviar.
  - `CampoDinheiro({ rotulo, valor: number | null, aoMudar: (centavos: number | null) => void })`: input texto com `lerReais`; inválido mostra "Valor inválido" e devolve `null`.

- [ ] **Step 1: Testes que falham**

```tsx
test("menu mostra só o que o perfil permite", async () => { /* governança: só "Governança"; recepção: Hoje, Mapa, Reservas, Caixa, Governança */ });
test("Review Focus 5: sem conexão mostra a faixa e desabilita ações; volta sozinho", async () => {
  /* fetch rejeita → faixa visível e botão "+ Nova reserva" disabled; fetch volta → faixa some */
});
test("JanelaSupervisor exige motivo e mostra erro do servidor", async () => {});
test("CampoDinheiro converte e sinaliza inválido", async () => {});
test("Gaveta fecha com Esc", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar (estilos com as variáveis dos tokens) → PASS.
- [ ] **Step 5: Commit** — `feat(web): casca com menu lateral, topo, conexão e componentes base`

---

### Task 7: Web — tela Hoje

**Files:**
- Create: `apps/web/src/telas/hoje/{TelaHoje,BlocoAtencao,ListaChegadas,ListaSaidas,BlocoGovernanca,ProximosDias}.tsx`
- Test: `apps/web/test/telas/hoje.test.tsx`

**Interfaces:**
- Consumes: `usePainel` (Task 5), `Painel` ampliado (Task 2), componentes (Task 6); abre o painel da reserva via `useNavigate()` para `?reserva=<id>` na rota atual (a Gaveta da reserva — Task 10 — lê esse parâmetro em qualquer tela).
- Produces: layout da spec seção 3 (aprovado no mockup):
  - Cabeçalho "Bom dia|Boa tarde|Boa noite, <primeiro nome>" (pela hora local do navegador — apenas saudação) e "<Dia-da-semana>, DD de <mês> · ocupação hoje: X de Y quartos (Z%)" usando `painel.dia`.
  - 5 cartões: Chegadas (`numeros.chegadas`, legenda "N já fez check-in"), Saídas, Hospedados ("N pessoas"), Quartos sujos ("N em manutenção"), Livres hoje ("p/ walk-in").
  - `BlocoAtencao`: título "Precisa da sua atenção (N)"; cada `ItemAtencao` renderizado genericamente (título, detalhe, telefone se houver) com botões por ação: `registrar_sinal` → abre reserva na aba Conta com o recebimento pré-preenchido com `sinalPendente`; `prorrogar_sinal` → `JanelaSupervisor` + campo nova data/hora → `POST /api/reservas/:id/prorrogar-sinal`; `marcar_no_show` → `JanelaSupervisor` → `POST .../no-show`; `abrir_reserva`/`abrir_conta` → abre a reserva; `resolver_alerta` → `POST /api/alertas/:id/resolver`. Não renderiza o bloco quando a fila está vazia.
  - `ListaChegadas`: quarto (ou "—"), titular, "N noites · A adultos + C crianças · canal", etiqueta (prioridade: `hospedada` → "hospedada"; `pendenciasFnrh` → "FNRH pendente"; `quartoNumero` nulo → "sem quarto"; `sinalPendente > 0` → "aguardando sinal"; senão "sinal pago"), botão "Check-in" (ou "Escolher quarto" sem quarto) que abre a reserva com o fluxo de check-in; nenhum botão se já hospedada.
  - `ListaSaidas`: quarto, titular, "saldo R$ X", botão "Check-out".
  - `BlocoGovernanca`: pílulas "103 sujo", "106 manutenção · chuveiro".
  - `ProximosDias`: "Amanhã (DD/MM)" e o dia seguinte pelo nome, "N chegadas · N saídas · ocupação X%", "lotado" quando 100%.

- [ ] **Step 1: Testes que falham**

```tsx
const painel = /* fixture com 2 itens de atenção, 3 chegadas (uma sem quarto, uma com FNRH pendente), 2 saídas, 1 sujo, próximos dias */;
test("mostra números e ocupação do dia vindos do servidor", async () => {
  renderizar(<TelaHoje />); expect(await screen.findByText(/ocupação hoje: 9 de 12 quartos \(75%\)/)).toBeInTheDocument();
});
test("atenção renderiza cada item com suas ações", async () => {
  expect(screen.getByRole("button", { name: "Registrar sinal" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Marcar no-show" })).toBeInTheDocument();
});
test("marcar no-show pede supervisor e chama a API", async () => { /* chamadas contém POST /api/reservas/r9/no-show com motivo e supervisor */ });
test("chegada sem quarto oferece Escolher quarto; FNRH pendente tem prioridade na etiqueta", async () => {});
test("saída mostra saldo formatado", async () => { expect(screen.getByText("saldo R$ 86,00")).toBeInTheDocument(); });
test("bloco de atenção some quando a fila está vazia", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): tela Hoje`

---

### Task 8: Web — mapa de ocupação (exibição e navegação)

**Files:**
- Create: `apps/web/src/telas/mapa/{TelaMapa,GradeMapa,BarraReserva,geometria.ts}.tsx`
- Test: `apps/web/test/telas/mapa.test.tsx`, `apps/web/test/telas/geometria.test.ts`

**Interfaces:**
- Consumes: `useMapa` (Task 5), `usePainel` para `dia`.
- Produces:
  - `geometria.ts` (puro): `colunasDoPeriodo(inicio: string, dias: number): string[]`; `posicaoBarra(b: { chegada; saida }, inicio: string, dias: number): { coluna: number; largura: number; cortadaInicio: boolean; cortadaFim: boolean } | null` (coluna 0-based; barra começa na coluna da chegada e cobre as noites até `saida` exclusiva; recortada nas bordas; `null` se fora do período); `linhaDeQuarto(quartos, barras)` agrupa por categoria e acrescenta uma linha "sem quarto" por categoria **só** se houver barra sem quarto naquela categoria.
  - `TelaMapa`: período padrão 14 dias começando em `painel.dia − 1`; seletor 7/14/30; botões "◀", "Hoje", "▶" (desloca pelo tamanho do período); filtro de categoria; cabeçalho de dias com nome curto e `DD/MM`, coluna de hoje destacada; quartos com indicador de situação (sujo/manutenção).
  - `BarraReserva`: cor por estado (`hospedada` terracota, `confirmada` verde, `pre_reserva` amarelo com texto escuro, `finalizada` cinza `#d8ccba`), texto "<titular>" e, se couber, "#<codigo>"; `title` com "titular · DD/MM–DD/MM · estado"; clique abre `?reserva=<id>`.
  - Clicar em célula vazia navega para `/reservas/nova?quarto=<id>&chegada=<data>`.

- [ ] **Step 1: Testes que falham**

```ts
test("posição da barra: chegada e saída dentro do período", () => {
  expect(posicaoBarra({ chegada: "2026-11-20", saida: "2026-11-23" }, "2026-11-19", 14)).toEqual({ coluna: 1, largura: 3, cortadaInicio: false, cortadaFim: false });
});
test("barra recortada no início e no fim", () => {
  expect(posicaoBarra({ chegada: "2026-11-15", saida: "2026-12-10" }, "2026-11-19", 14)).toEqual({ coluna: 0, largura: 14, cortadaInicio: true, cortadaFim: true });
});
test("barra fora do período é null", () => { expect(posicaoBarra({ chegada: "2026-12-10", saida: "2026-12-12" }, "2026-11-19", 7)).toBeNull(); });
test("linha 'sem quarto' só quando há reserva sem quarto", () => {});
```
```tsx
test("mapa mostra quartos por categoria e barras com cores por estado", async () => {});
test("navegar ▶ pede o próximo período à API", async () => { /* chamadas contém GET /api/mapa?inicio=2026-12-03&fim=2026-12-16 */ });
test("clicar na barra abre a reserva; em célula vazia abre nova reserva com quarto e data", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar (grade em CSS Grid; colunas de largura fixa ≥ 44 px com rolagem horizontal) → PASS.
- [ ] **Step 5: Commit** — `feat(web): mapa de ocupação`

---

### Task 9: Web — arrastar e esticar no mapa com prévia

**Files:**
- Create: `apps/web/src/telas/mapa/{usoArrastar.ts,JanelaPreviaAlteracao.tsx}`
- Modify: `apps/web/src/telas/mapa/{GradeMapa,BarraReserva}.tsx`
- Test: `apps/web/test/telas/arrastar.test.tsx`

**Interfaces:**
- Consumes: `geometria.ts` (Task 8), `useAcao` (Task 5)
- Produces:
  - `usoArrastar(opcoes: { larguraColuna: number; alturaLinha: number; linhas: { quartoId: string | null; categoriaId: string }[]; inicio: string; aoSoltar: (m: Movimento) => void })` com Pointer Events (`pointerdown/move/up`, `setPointerCapture`); limiar de 6 px antes de considerar arrasto (abaixo disso é clique).
  - `type Movimento = { reservaId: string; tipo: "mover" | "esticar"; quartoId?: string; chegada?: string; saida?: string }` — "mover" desloca chegada e saída pelo mesmo número de colunas e troca o quarto pela linha de destino; "esticar" (alça na ponta direita, 8 px) muda só a saída (mínimo 1 noite).
  - Sem mudança (mesmo quarto e mesmas datas) ou soltar fora da grade → nenhum `aoSoltar`.
  - Reserva `hospedada`: não move a chegada (só troca de quarto na mesma coluna ou estica a saída); `finalizada`/`cancelada`: não arrastável.
  - `JanelaPreviaAlteracao`: chama `GET /api/reservas/:id/previa?…` e mostra "De R$ X para R$ Y" e a lista de noites com valor; botões "Confirmar" (→ `PATCH /api/reservas/:id`) e "Cancelar"; se a API exigir supervisor (`RESTRICAO_TARIFARIA`, `SUPERVISOR_NECESSARIO`), abre `JanelaSupervisor` e reenvia com `autorizacao`; erro (`QUARTO_INDISPONIVEL`, `NOITE_JA_LANCADA`) aparece em `ErroAcao` e nada muda.

- [ ] **Step 1: Testes que falham**

```tsx
test("arrastar 2 colunas para a direita e 1 linha abaixo gera mover com novas datas e quarto", async () => {
  /* fireEvent.pointerDown/Move/Up com coordenadas; aoSoltar chamado com { tipo: "mover", quartoId: "q102", chegada: "2026-11-22", saida: "2026-11-25" } */
});
test("esticar a ponta direita muda só a saída", async () => {});
test("Review Focus 3: soltar no mesmo lugar ou fora da grade não chama a API nem abre janela", async () => {
  /* chamadas não contém PATCH nem GET .../previa; nenhum role=dialog */
});
test("movimento abaixo de 6 px é clique e abre a reserva", async () => {});
test("hospedada não move a chegada", async () => {});
test("prévia mostra de/para e confirma com PATCH", async () => {});
test("erro QUARTO_INDISPONIVEL aparece e nada é gravado", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): arrastar e esticar reservas no mapa com prévia`

---

### Task 10: Web — painel da reserva (resumo, hóspedes e ações de estado)

**Files:**
- Create: `apps/web/src/telas/reserva/{GavetaReserva,AbaResumo,AbaHospedes,AcoesReserva}.tsx`
- Modify: `apps/web/src/layout/Shell.tsx` (renderiza `GavetaReserva` quando houver `?reserva=` em qualquer rota)
- Test: `apps/web/test/telas/reserva.test.tsx`

**Interfaces:**
- Consumes: `useReserva` (Task 5), `Gaveta`, `JanelaSupervisor` (Task 6)
- Produces:
  - `GavetaReserva`: lê `reserva` (id) e `aba` (`resumo` | `conta` | `hospedes`; padrão `resumo`) e `fluxo` (`checkin` | `checkout`, opcional) da URL; cabeçalho "#<codigo> · <titular> · Qto <numero|sem quarto>", "DD/MM → DD/MM · A adultos + C crianças", etiqueta do estado; abas; fechar remove os parâmetros.
  - `AbaResumo`: canal, observações; sinal ("R$ X · pago R$ Y · prazo DD/MM HH:MM" quando `pre_reserva`); tabela de diárias congeladas com `passos` expansíveis ("Base R$ 280,00 → Sábado +15% …"); total.
  - `AbaHospedes`: titular e acompanhantes com pendências de FNRH (lista dos campos faltantes).
  - `AcoesReserva` por estado: `pre_reserva` → "Registrar sinal" (abre aba Conta com valor pendente), "Prorrogar sinal", "Cancelar"; `confirmada` → "Fazer check-in" (`fluxo=checkin`, Task 12), "Cancelar", "Marcar no-show" (só se `chegada < painel.dia`); `hospedada` → "Lançar extra" (aba Conta), "Fazer check-out" (`fluxo=checkout`, Task 13); `finalizada|cancelada|no_show` → nenhuma ação. Cancelar/no-show/prorrogar usam `JanelaSupervisor` e as rotas do Plano A.

- [ ] **Step 1: Testes que falham**

```tsx
test("abre pelo parâmetro ?reserva e mostra cabeçalho", async () => { /* "#128 · Maria Silva · Qto 101" */ });
test("diárias mostram o detalhamento do cálculo", async () => { /* expandir → "Sábado +15%" */ });
test("ações dependem do estado", async () => { /* pre_reserva: Registrar sinal/Prorrogar/Cancelar; hospedada: Lançar extra/Fazer check-out */ });
test("cancelar pede supervisor e envia motivo", async () => {});
test("clicar em outra barra troca a reserva sem fechar a gaveta", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): painel deslizante da reserva`

---

### Task 11: Web — aba Conta (extrato, extras, recebimentos e estornos)

**Files:**
- Create: `apps/web/src/telas/reserva/{AbaConta,FormLancarExtra,FormReceber}.tsx`
- Test: `apps/web/test/telas/conta.test.tsx`

**Interfaces:**
- Consumes: `useConta` (Task 5) → `GET /api/contas/:id` `{ saldo, extrato }`; `GET /api/produtos`; `GET /api/formas-pagamento`; `useCaixa`.
- Produces:
  - `AbaConta`: extrato em tabela (data, descrição, origem, valor; estornos em itálico com sinal negativo); totais Débitos / Créditos / **Saldo**; botão "Estornar" por linha (lançamento ou pagamento não estornado) → `JanelaSupervisor` → `POST /api/lancamentos/:id/estornar` ou `/api/pagamentos/:id/estornar`.
  - `FormLancarExtra`: produto (lista de `/api/produtos`) **ou** descrição livre + valor (`CampoDinheiro`), quantidade (inteiro ≥ 1) → `POST /api/contas/:id/lancamentos` `{ tipo: "extra", ... }`.
  - `FormReceber`: forma (ativas, **sem** `faturado`), valor (`CampoDinheiro`, pré-preenchido com o valor indicado na URL `&receber=<centavos>` quando vier de "Registrar sinal") → `POST /api/contas/:id/pagamentos` com `reservaId`. Sem caixa aberto: aviso "Abra o caixa para receber pagamentos" com link para `/caixa` em vez do formulário.

- [ ] **Step 1: Testes que falham**

```tsx
test("extrato com saldo", async () => { expect(screen.getByText("Saldo")).toBeInTheDocument(); expect(screen.getByText("R$ 450,00")).toBeInTheDocument(); });
test("lançar extra envia centavos inteiros", async () => { /* digitar "12,50", qtd 2 → corpo { valorUnitario: 1250, quantidade: 2 } */ });
test("registrar sinal pré-preenche o valor pendente", async () => {});
test("formas não incluem faturado", async () => {});
test("sem caixa aberto mostra aviso com link", async () => {});
test("estornar pede supervisor", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): conta do hóspede no painel da reserva`

---

### Task 12: Web — fluxo de check-in

**Files:**
- Create: `apps/web/src/telas/reserva/{FluxoCheckin,CadastroRapidoHospede}.tsx`
- Test: `apps/web/test/telas/checkin.test.tsx`

**Interfaces:**
- Consumes: `GET /api/reservas/:id/quartos-sugeridos`, `GET/POST /api/hospedes`, `POST /api/reservas/:id/checkin`.
- Produces:
  - `FluxoCheckin` (dentro da gaveta, `fluxo=checkin`): 1) Quarto — lista sugerida (o atribuído marcado primeiro), opção "outra categoria (upgrade)" listando `GET /api/quartos` livres com aviso "preço mantido"; 2) Hóspedes — titular e acompanhantes (buscar por nome/CPF ou `CadastroRapidoHospede`), mostrando pendências de FNRH de cada um com botão "Completar" que abre o cadastro preenchido; 3) checkbox "Cobrar early check-in, se aplicável" marcado por padrão (o servidor só cobra se o check-in for antes do horário configurado e a taxa for maior que zero); 4) "Concluir check-in".
  - `CadastroRapidoHospede`: campos da FNRH (nome, tipo de documento, documento, nascimento, nacionalidade, cidade, UF, telefone, e-mail) → `POST /api/hospedes`; erros por campo vindos da API (`DADOS_INVALIDOS.campos`, `CPF_INVALIDO`) aparecem junto ao campo.
  - Em `FNRH_INCOMPLETA` (`detalhes: { [hospedeId]: string[] }`) o fluxo destaca os hóspedes e campos faltantes; em sucesso mostra "Check-in concluído · Qto 101" e volta à aba Resumo.

- [ ] **Step 1: Testes que falham**

```tsx
test("sugere quartos limpos com o atribuído primeiro", async () => {});
test("FNRH_INCOMPLETA destaca o hóspede e os campos faltantes", async () => {});
test("cadastro rápido mostra CPF inválido no campo", async () => {});
test("concluir envia quarto, acompanhantes e escolha de early check-in", async () => {
  /* corpo { quartoId: "q101", acompanhantes: ["h2"], cobrarEarlyCheckin: false } */
});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): fluxo de check-in`

---

### Task 13: Web — fluxo de check-out

**Files:**
- Create: `apps/web/src/telas/reserva/FluxoCheckout.tsx`
- Test: `apps/web/test/telas/checkout.test.tsx`

**Interfaces:**
- Consumes: `GET /api/reservas/:id/checkout` (prévia: `{ extrato, saldo, lateCheckout?, saidaAntecipada }`), `POST /api/reservas/:id/checkout`.
- Produces:
  - `FluxoCheckout` (`fluxo=checkout`): mostra a prévia (extrato resumido, aviso "Saída antecipada — as noites seguintes serão canceladas" quando aplicável, late checkout com checkbox "Cobrar late check-out" e valor); **pagamentos divididos**: linhas forma + valor (`CampoDinheiro`), "+ outra forma", restante calculado ("Falta R$ X" / "Sobra R$ X" em terracota); seção opcional **Faturar** (nome, documento, valor); botão "Concluir check-out" habilitado só quando restante = 0.
  - Envia `{ pagamentos, faturado?, cobrarLateCheckout }`. Em erro (`SALDO_PENDENTE`, `CAIXA_FECHADO`, `ESTADIA_EXCEDIDA`…) mantém tudo o que foi digitado e mostra `ErroAcao` (Review Focus 4). Sucesso: "Check-out concluído · quarto 101 enviado para limpeza" e fecha a gaveta.

- [ ] **Step 1: Testes que falham**

```tsx
test("pagamento dividido zera o restante e habilita concluir", async () => { /* saldo 95000; pix 50000 + crédito 45000 → "Falta R$ 0,00", botão habilitado */ });
test("faturado entra no cálculo do restante", async () => {});
test("late checkout soma ao saldo quando marcado", async () => {});
test("Review Focus 4: erro do servidor mantém valores e mostra mensagem", async () => {
  /* POST → 422 SALDO_PENDENTE "Ainda falta receber R$ 10,00."; campos continuam com 50.000/45.000; alerta visível; gaveta aberta */
});
test("saída antecipada mostra aviso", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): fluxo de check-out`

---

### Task 14: Web — nova reserva (com cotação e grupo)

**Files:**
- Create: `apps/web/src/telas/nova-reserva/{TelaNovaReserva,SeletorHospede,QuadroCotacao}.tsx`
- Test: `apps/web/test/telas/nova-reserva.test.tsx`

**Interfaces:**
- Consumes: `GET /api/categorias`, `GET /api/quartos`, `GET /api/tarifas/canais`, `GET /api/hospedes?q=`, `POST /api/tarifas/simular`, `POST /api/reservas`, `POST /api/grupos`, `CadastroRapidoHospede` (Task 12).
- Produces:
  - `TelaNovaReserva` em `/reservas/nova` (aceita `?quarto=&chegada=` vindos do mapa): `SeletorHospede` (busca com debounce 300 ms, mínimo 2 caracteres, ou "Cadastrar novo"), categoria, quarto (opcional, filtrado pela categoria), chegada, saída (padrão chegada+1), adultos, crianças (lista de datas de nascimento, "+ criança"), canal (padrão Balcão), desconto %, observações.
  - `QuadroCotacao`: a cada mudança relevante (debounce 400 ms) chama `/api/tarifas/simular`; mostra noites (DD/MM, valor, detalhamento expansível), total, desconto aplicado, **sinal** ("Sinal de R$ X até DD/MM HH:MM" quando o canal exige) e violações de restrição em aviso amarelo ("Mínimo de 3 noites a partir de 31/12").
  - "Reservar": `POST /api/reservas`; se a API pedir supervisor (desconto acima do limite, restrição), abre `JanelaSupervisor` e reenvia com `autorizacao`; sucesso navega para `/mapa?reserva=<id>`.
  - **Grupo**: alternador "Reserva de grupo" → escolhe cobrança (conta única / separada) e adiciona várias linhas quarto+pessoas; cria o grupo (`POST /api/grupos`) e uma reserva por linha com `grupoId`; erros por linha.

- [ ] **Step 1: Testes que falham**

```tsx
test("vem do mapa com quarto e chegada preenchidos", async () => {});
test("mostra cotação com sinal e restrições", async () => { /* "Sinal de R$ 270,00", aviso "Mínimo de 3 noites" */ });
test("desconto acima do limite pede supervisor e reenvia", async () => {
  /* 1ª POST → 422 SUPERVISOR_NECESSARIO; JanelaSupervisor; 2ª POST contém autorizacao */
});
test("datas inválidas (saída antes da chegada) bloqueiam o envio", async () => {});
test("grupo cria um grupo e uma reserva por quarto", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): nova reserva com cotação e grupo`

---

### Task 15: Web — lista de reservas e caixa

**Files:**
- Create: `apps/web/src/telas/reservas/TelaReservas.tsx`, `apps/web/src/telas/caixa/TelaCaixa.tsx`
- Test: `apps/web/test/telas/reservas.test.tsx`, `apps/web/test/telas/caixa.test.tsx`

**Interfaces:**
- Consumes: `GET /api/reservas` (Task 1), `GET /api/caixa/atual` (Task 1), `POST /api/caixa/abrir`, `POST /api/caixa/fechar`, `GET /api/formas-pagamento`.
- Produces:
  - `TelaReservas`: filtros período (padrão: hoje −7 a +30 a partir de `painel.dia`), estados (chips), canal, texto; tabela (código, titular, quarto, categoria, chegada, saída, estado, total); paginação 50 por página; clicar na linha abre `?reserva=<id>`; filtros refletidos na URL.
  - `TelaCaixa`: sem turno → formulário "Abrir caixa" (valor inicial em dinheiro). Com turno → "Aberto às HH:MM", tabela de movimentos (hora, origem, forma, valor), esperado por forma; "Fechar caixa" → para cada forma esperada um `CampoDinheiro` "Contado" → `POST /api/caixa/fechar` → relatório com esperado/contado/diferença por forma (diferença ≠ 0 em terracota) e botão "Concluir".

- [ ] **Step 1: Testes que falham**

```tsx
test("filtros viram parâmetros da API e da URL", async () => { /* GET /api/reservas?inicio=…&estado=confirmada,pre_reserva&q=maria */ });
test("paginação pede a página 2", async () => {});
test("abrir caixa envia valor inicial em centavos", async () => {});
test("fechar caixa mostra diferenças por forma", async () => { /* dinheiro esperado 15000 contado 14000 → "−R$ 10,00" */ });
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): lista de reservas e caixa`

---

### Task 16: Web — governança no celular e busca Ctrl+K

**Files:**
- Create: `apps/web/src/telas/governanca/TelaGovernanca.tsx`, `apps/web/src/telas/busca/BuscaUniversal.tsx`
- Modify: `apps/web/src/layout/BarraTopo.tsx`
- Test: `apps/web/test/telas/governanca.test.tsx`, `apps/web/test/telas/busca.test.tsx`

**Interfaces:**
- Consumes: `GET /api/governanca`, `POST /api/quartos/:id/{limpo,manutencao,bloquear,liberar}`, `GET /api/busca?q=`.
- Produces:
  - `TelaGovernanca`: grade de botões grandes (mín. 72 px de altura, 2 colunas abaixo de 600 px), sujos primeiro, cada um com número, situação e "hospedado até DD/MM"; tocar num sujo → confirma "Marcar 103 como limpo?" → `POST .../limpo`. Para quem tem `quartos.manutencao`: menu do quarto com "Manutenção", "Bloquear", "Liberar" pedindo motivo (`Janela` com campo motivo).
  - `BuscaUniversal`: `Ctrl+K` (e `Cmd+K`) em qualquer tela abre a `Janela` de busca com foco no campo; debounce 250 ms, mínimo 1 caractere; resultados agrupados (Quartos, Reservas, Hóspedes) com `rotulo` e botões das `acoes`: `abrir`/`ver_quarto` → abre reserva/filtra mapa; `checkin` → `?reserva=<id>&fluxo=checkin`; `checkout` → `&fluxo=checkout`; `registrar_pagamento` → `&aba=conta`; `lancar_extra` → `&aba=conta`; `nova_reserva` → `/reservas/nova?hospede=<id>`; `ver_historico` → `/reservas?q=<nome>`. Setas ↑↓ navegam, Enter executa a primeira ação, Esc fecha. Sem `reservas.gerenciar` o gatilho não aparece.

- [ ] **Step 1: Testes que falham**

```tsx
test("governança: tocar em quarto sujo marca limpo após confirmar", async () => {});
test("governança: motivo obrigatório para manutenção", async () => {});
test("Ctrl+K abre a busca com foco e Enter executa a primeira ação", async () => {
  /* digitar "maria" → resultado reserva com ação checkin → Enter → URL contém fluxo=checkin */
});
test("setas navegam entre resultados", async () => {});
```

- [ ] **Step 2–4:** falhar → implementar → PASS.
- [ ] **Step 5: Commit** — `feat(web): governança no celular e busca universal`

---

### Task 17: PWA, build integrado e teste ponta a ponta no navegador

**Files:**
- Create: `apps/web/public/{manifest.webmanifest,icone.svg}`, `apps/web/playwright.config.ts`, `apps/web/e2e/recepcao.spec.ts`, `apps/web/e2e/preparar.ts`
- Modify: `apps/web/index.html` (manifest, `theme-color #2f6f5e`, título "ERP Hotelaria"), `package.json` raiz (scripts `build` = build da web; `start` = start do servidor; `demo`; `e2e`), `apps/web/package.json` (`@playwright/test@^1`), `.gitignore` (`apps/web/test-results`, `apps/web/playwright-report`)
- Test: `apps/web/e2e/recepcao.spec.ts`

**Interfaces:**
- Produces:
  - `manifest.webmanifest`: `name` "ERP Hotelaria", `short_name` "ERP", `display` "standalone", `background_color` "#faf6ef", `theme_color` "#2f6f5e", ícone SVG (sol estilizado nas cores dos tokens). Sem service worker.
  - `e2e/preparar.ts` (globalSetup do Playwright): build da web, cria banco temporário, roda `semearDemonstracao`, sobe o servidor (`ERP_DB`, `ERP_PORTA=8099`, `ERP_WEB_DIR=apps/web/dist`) e derruba ao final; apaga o banco.
  - `playwright.config.ts`: Chromium, `baseURL http://localhost:8099`, projeto "desktop" (1366×768) e projeto "celular" (390×844) só para o teste de governança.
  - Roteiro (`recepcao.spec.ts`):
    1. Login `admin`/`admin` → obrigado a trocar senha → troca para `admin123` → cai em Hoje.
    2. Hoje mostra "Precisa da sua atenção" com sinal vencendo; clicar "Registrar sinal" → caixa fechado leva a `/caixa` → abrir caixa com R$ 100,00 → voltar e registrar o sinal em PIX → item some da atenção.
    3. Nova reserva para hoje (hóspede existente, Standard, 2 noites, Balcão) → aparece no mapa.
    4. Check-in de uma chegada de hoje com quarto sugerido.
    5. Na reserva hospedada que sai hoje: lançar extra "Frigobar" R$ 12,00 → check-out pagando o saldo dividido em dinheiro + crédito → quarto aparece como sujo em Hoje.
    6. Fechar caixa informando os valores esperados → todas as diferenças R$ 0,00.
    7. (celular) Login `governanca`/`governanca123` → tela Governança → marcar o quarto sujo como limpo.

- [ ] **Step 1: Escrever o roteiro e ver falhar** — `npm run e2e` → FAIL (antes dos ajustes finais/manifest).
- [ ] **Step 2: Implementar** manifest, ícone, scripts e ajustes que o roteiro revelar.
- [ ] **Step 3: Rodar** — `npm run e2e` → PASS nos dois projetos; `npm test -w apps/web`, `npm test -w apps/server`, typechecks → PASS.
- [ ] **Step 4: Verificação manual** — `npm run build && ERP_DB=./dados/demo.db npm run demo && npm start`; abrir `http://localhost:8080` e conferir login, Hoje e mapa.
- [ ] **Step 5: Commit** — `feat(web): PWA, build integrado e teste ponta a ponta da recepção`
