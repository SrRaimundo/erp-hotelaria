# Módulo Financeiro — Fase 1 MVP (2 meses)

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans` para implementar task-by-task.

**Objetivo:** Implementar 4 fluxos do Financeiro (Locais, Cadastros, Contas a Receber, Caixa/Banco, Faturamento) integrados com Hospedagem e Reservas, funcional offline com sincronização automática.

**Arquitetura:** Monolito modular (padrão do projeto). Financeiro consome eventos de Hospedagem (checkouts) e Reservas (sinais) via barramento. Cria lançamentos automáticos roteados para Caixa/Banco ou Faturamento conforme forma de pagamento. Sincroniza com nuvem via Outbox + idempotência.

**Tech Stack:** TypeScript, Node.js, SQLite (local), eventos de domínio, TDD

**Spec:** `docs/superpowers/specs/2026-10-30-financeiro-design.md`

## Global Constraints

- **Moeda:** BRL sempre (futuro suportar multi-moeda)
- **Forma de pagamento:** dinheiro, PIX, débito, crédito, cheque, boleto
- **Offline-first:** operação sem internet; sincronização automática ao conectar
- **Auditoria obrigatória:** usuário, dispositivo, data/hora, motivo (se ação sensível)
- **Isolamento:** múltiplos locais por servidor, cada um com suas movimentações
- **Idempotência:** eventos com UUID; reenvio não duplica lançamento

## Review Focus

1. **Integridade de saldo:** Movimento + Saldo calculados corretamente, não perdem transações offline
2. **Roteamento de forma de pagamento:** Dinheiro/PIX → Caixa direto | Débito/Crédito → Cartão (futuro); vão para conta correta
3. **Faturamento automático:** Checkout marcado "faturado" gera automaticamente Faturamento + ContaReceber sem operador intervir
4. **Auditoria em ações críticas:** Deletar, cancelar, ajustar saldo exigem supervisor + motivo registrados
5. **Sincronização não perde dados:** Offline cria lançamentos localmente; ao conectar, envia em ordem, recebe confirmação, remove do Outbox; reenvio duplicado ignorado

---

## Estrutura de Arquivos

```
apps/server/src/financeiro/
├── modelos/
│   ├── local.ts              # Local {id, pousada_id, nome, parametros}
│   ├── cadastros.ts          # Cliente, Fornecedor, ContaBancaria, Moeda
│   ├── lançamento.ts         # Lançamento (núcleo)
│   ├── faturamento.ts        # Faturamento
│   ├── conta-receber.ts      # ContaReceber
│   ├── movimento.ts          # Movimento, Saldo
│   └── cartao-credito.ts     # CartaoCredito (futuro, não MVP)
│
├── servicos/
│   ├── locais.ts             # LocalService: criar, listar, atualizar
│   ├── cadastros.ts          # CadastroService: clientes, fornecedores, contas
│   ├── lançamentos.ts        # LançamentoService: criar, cancelar, estornar
│   ├── faturamento.ts        # FaturamentoService: criar, gerar cobrança, liquidar
│   ├── contas-receber.ts     # ContasReceberService: rastrear, confirmar pagamento
│   └── caixa-banco.ts        # CaixaBancoService: movimentos, saldos, transferências
│
├── consumidores-eventos/
│   ├── hospedagem-checkout.ts  # Consome CheckoutFinalizado → Lançamentos
│   ├── reserva-sinal.ts        # Consome SinalReservaRecebido → Lançamentos
│
├── rotas/
│   ├── locais.ts             # GET/POST/PUT locais
│   ├── cadastros.ts          # CRU clientes, fornecedores, contas
│   ├── lançamentos.ts        # GET lançamentos, POST cancelamento
│   ├── faturamento.ts        # POST gerar cobrança, PUT confirmar recebimento
│   ├── contas-receber.ts     # GET posição, PUT confirmar pagamento
│   └── caixa-banco.ts        # GET movimento, saldos; POST transferência
│
├── migracao.ts               # Migrações SQLite (tabelas, índices)
└── rotas.ts                  # Agregador de todas as rotas
```

---

## Tarefas

### Task 1: Migrações de Banco de Dados

**Arquivos:**
- Criar: `apps/server/src/financeiro/migracao.ts`
- Modificar: `apps/server/src/shared/migracoes.ts` (registrar migrações)

**Interfaces:**
- Consome: infra.banco (função que executa SQL)
- Produz: tabelas criadas em SQLite com índices

**Passos:**

- [ ] **Passo 1: Escrever teste de migração**

```typescript
test("migração: criar tabelas de financeiro", async () => {
  const banco = criarBancoEmMemoria();
  await executarMigracoes(banco);
  
  // Verificar que as tabelas existem
  const tabelas = await banco.todas(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fin_%'"
  );
  
  expect(tabelas.length).toBeGreaterThanOrEqual(7); // local, cliente, fornecedor, conta_bancaria, lancamento, faturamento, conta_receber, movimento, saldo
});
```

- [ ] **Passo 2: Executar teste para verificar falha**

Run: `npm test -- financeiro/migracao.test.ts`
Esperado: FAIL (tabelas não existem)

- [ ] **Passo 3: Implementar migrações em `financeiro/migracao.ts`**

Criar tabelas com colunas e índices segundo spec:

```typescript
async function executarMigracoes(banco: Banco) {
  // 1. fin_local {id UUID PK, pousada_id FK, nome, ativo, parametros JSON}
  await banco.executar(`
    CREATE TABLE IF NOT EXISTS fin_local (
      id TEXT PRIMARY KEY,
      pousada_id TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      ativo BOOLEAN DEFAULT 1,
      parametros TEXT, -- JSON {local_padrao_hospedagem, local_padrao_reserva}
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pousada_id) REFERENCES nc_pousada(id)
    )
  `);
  
  // 2. fin_cliente {id, local_id FK, nome, cpf_cnpj, tipo, contato JSON}
  // 3. fin_fornecedor {...}
  // 4. fin_conta_bancaria {...}
  // 5. fin_moeda {...}
  // 6. fin_lancamento {...}
  // 7. fin_faturamento {...}
  // 8. fin_conta_receber {...}
  // 9. fin_movimento {...}
  // 10. fin_saldo {...}
  
  // Índices para queries frequentes
  await banco.executar("CREATE INDEX IF NOT EXISTS idx_lancamento_local_data ON fin_lancamento(local_id, data)");
  await banco.executar("CREATE INDEX IF NOT EXISTS idx_conta_receber_status ON fin_conta_receber(status)");
  await banco.executar("CREATE INDEX IF NOT EXISTS idx_movimento_conta ON fin_movimento(conta_id, data)");
}
```

- [ ] **Passo 4: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/migracao.test.ts`
Esperado: PASS

- [ ] **Passo 5: Registrar migrações em `shared/migracoes.ts`**

Adicionar ao array de migracoes importado: `import { executarMigracoes as fin } from "../financeiro/migracao";`

- [ ] **Passo 6: Commit**

```bash
git add apps/server/src/financeiro/migracao.ts apps/server/src/shared/migracoes.ts tests/financeiro/migracao.test.ts
git commit -m "feat: migrações de banco para módulo Financeiro

Cria 10 tabelas: local, cliente, fornecedor, conta_bancaria, moeda, lançamento, faturamento, conta_receber, movimento, saldo com índices para queries frequentes."
```

---

### Task 2: Modelos de Dados — Local, Cadastros, Lançamento

**Arquivos:**
- Criar: `apps/server/src/financeiro/modelos/local.ts`
- Criar: `apps/server/src/financeiro/modelos/cadastros.ts`
- Criar: `apps/server/src/financeiro/modelos/lançamento.ts`
- Criar: `tests/financeiro/modelos.test.ts`

**Interfaces:**
- Consome: tipos compartilhados (UUID, Dinheiro, Auditoria)
- Produz: tipos TypeScript exportados (Local, Cliente, Fornecedor, ContaBancaria, Moeda, Lançamento)

**Passos:**

- [ ] **Passo 1: Escrever teste para tipos Local, Cliente, Lançamento**

```typescript
test("Local: criar e validar", () => {
  const local: Local = {
    id: gerarUUID(),
    pousada_id: gerarUUID(),
    nome: "Pousada Principal",
    ativo: true,
    parametros: {
      local_padrao_hospedagem: gerarUUID(),
      local_padrao_reserva: gerarUUID(),
    },
  };
  
  expect(local.nome).toBe("Pousada Principal");
  expect(local.ativo).toBe(true);
});

test("Cliente: criar e validar", () => {
  const cliente: Cliente = {
    id: gerarUUID(),
    local_id: gerarUUID(),
    nome: "João Silva",
    cpf_cnpj: "123.456.789-10",
    tipo: "pessoa_fisica",
    contato: {email: "joao@example.com", telefone: "11999999999", endereco: {...}},
  };
  
  expect(cliente.tipo).toBe("pessoa_fisica");
});

test("Lançamento: criar e validar", () => {
  const lancamento: Lançamento = {
    id: gerarUUID(),
    local_id: gerarUUID(),
    data: new Date("2026-11-10"),
    tipo: "recebimento",
    origem: "hospedagem",
    valor: Dinheiro.de(500),
    forma_pagamento: "dinheiro",
    status: "confirmado",
    referencia_id: gerarUUID(),
    auditoria: {
      criado_por: "usuario@example.com",
      data_criacao: new Date(),
      dispositivo: "web",
    },
  };
  
  expect(lancamento.tipo).toBe("recebimento");
  expect(lancamento.valor.centavos).toBe(50000);
});
```

- [ ] **Passo 2: Executar teste para verificar falha**

Run: `npm test -- financeiro/modelos.test.ts`
Esperado: FAIL (tipos não definidos)

- [ ] **Passo 3: Implementar tipos em `modelos/local.ts`, `modelos/cadastros.ts`, `modelos/lançamento.ts`**

```typescript
// modelos/local.ts
export interface Local {
  id: UUID;
  pousada_id: UUID; // Fk Núcleo.Pousada
  nome: string;
  ativo: boolean;
  parametros: {
    local_padrao_hospedagem: UUID;
    local_padrao_reserva: UUID;
  };
}

// modelos/cadastros.ts
export interface Cliente {
  id: UUID;
  local_id: UUID;
  nome: string;
  cpf_cnpj: string; // unique per local
  tipo: "pessoa_fisica" | "pessoa_juridica";
  contato: {
    email: string;
    telefone: string;
    endereco: Endereco;
  };
}

export interface Fornecedor {
  id: UUID;
  local_id: UUID;
  razao_social: string;
  cnpj: string;
  contato: {...};
  banco: {banco: string; agencia: string; conta: string};
}

export interface ContaBancaria {
  id: UUID;
  local_id: UUID;
  nome: string;
  banco: string;
  agencia: string;
  numero: string;
  tipo: "corrente" | "poupanca";
  saldo_inicial: Dinheiro;
}

// modelos/lançamento.ts
export interface Lançamento {
  id: UUID;
  local_id: UUID;
  data: Date;
  tipo: "recebimento" | "pagamento" | "transferencia" | "ajuste";
  origem: "hospedagem" | "reserva" | "bar" | "lavanderia" | "rh" | "manual";
  valor: Dinheiro;
  forma_pagamento: "dinheiro" | "pix" | "debito" | "credito" | "cheque" | "boleto";
  status: "pendente" | "confirmado" | "liquidado" | "cancelado";
  referencia_id: UUID;
  auditoria: Auditoria;
}
```

- [ ] **Passo 4: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/modelos.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/modelos/*.ts tests/financeiro/modelos.test.ts
git commit -m "feat: modelos de dados do Financeiro — Local, Cadastros, Lançamento

Define tipos TypeScript para Local, Cliente, Fornecedor, ContaBancaria, Moeda, Lançamento com validações básicas."
```

---

### Task 3: Modelos — Faturamento, ContaReceber, Movimento/Saldo

**Arquivos:**
- Criar: `apps/server/src/financeiro/modelos/faturamento.ts`
- Criar: `apps/server/src/financeiro/modelos/conta-receber.ts`
- Criar: `apps/server/src/financeiro/modelos/movimento.ts`
- Modificar: `tests/financeiro/modelos.test.ts` (adicionar testes)

**Interfaces:**
- Consome: tipos de Task 2 (Local, Cliente, Lançamento)
- Produz: tipos Faturamento, ContaReceber, Movimento, Saldo

**Passos:**

- [ ] **Passo 1: Escrever testes para Faturamento, ContaReceber, Movimento**

```typescript
test("Faturamento: criar e rastrear pagamentos", () => {
  const fat: Faturamento = {
    id: gerarUUID(),
    local_id: gerarUUID(),
    cliente_id: gerarUUID(),
    referencia_id: gerarUUID(), // checkout_id
    valor_original: Dinheiro.de(1000),
    valor_liquido: Dinheiro.de(950),
    data_vencimento: new Date("2026-12-10"),
    forma_cobranca: "boleto",
    numero_documento: "FAT-00001",
    status: "aberto",
    lançamentos_id: [],
  };
  
  expect(fat.status).toBe("aberto");
  expect(fat.valor_liquido.centavos).toBe(95000);
});

test("Movimento: rastrear credito e debito com saldo", () => {
  const mov: Movimento = {
    id: gerarUUID(),
    local_id: gerarUUID(),
    conta_id: gerarUUID(),
    lançamento_id: gerarUUID(),
    tipo: "credito",
    valor: Dinheiro.de(500),
    saldo_anterior: Dinheiro.de(10000),
    saldo_posterior: Dinheiro.de(10500),
    data: new Date(),
  };
  
  expect(mov.saldo_posterior.centavos).toBe(1050000);
});

test("Saldo: calcular a partir de Movimentos", () => {
  const saldo: Saldo = {
    id: gerarUUID(),
    conta_id: gerarUUID(),
    data: new Date("2026-11-10"),
    saldo: Dinheiro.de(5000),
  };
  
  expect(saldo.saldo.centavos).toBe(500000);
});
```

- [ ] **Passo 2: Executar teste para verificar falha**

Run: `npm test -- financeiro/modelos.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar tipos**

```typescript
// modelos/faturamento.ts
export interface Faturamento {
  id: UUID;
  local_id: UUID;
  cliente_id: UUID;
  referencia_id: UUID; // checkout_id
  valor_original: Dinheiro;
  valor_liquido: Dinheiro;
  data_vencimento: Date;
  forma_cobranca: "boleto" | "pix" | "deposito";
  numero_documento: string;
  status: "aberto" | "parcialmente_pago" | "pago" | "cancelado";
  lançamentos_id: UUID[];
}

// modelos/conta-receber.ts
export interface ContaReceber {
  id: UUID;
  local_id: UUID;
  cliente_id: UUID;
  numero_documento: string;
  valor_original: Dinheiro;
  valor_recebido: Dinheiro;
  data_vencimento: Date;
  forma_pagamento: "boleto" | "pix" | "deposito" | "dinheiro";
  status: "pendente" | "parcialmente_recebido" | "recebido" | "cancelado";
  conta_destino_id: UUID | null;
  lançamentos_id: UUID[];
}

// modelos/movimento.ts
export interface Movimento {
  id: UUID;
  local_id: UUID;
  conta_id: UUID;
  lançamento_id: UUID;
  tipo: "credito" | "debito" | "transferencia_out" | "transferencia_in";
  valor: Dinheiro;
  saldo_anterior: Dinheiro;
  saldo_posterior: Dinheiro;
  data: Date;
}

export interface Saldo {
  id: UUID;
  conta_id: UUID;
  data: Date;
  saldo: Dinheiro;
}
```

- [ ] **Passo 4: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/modelos.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/modelos/faturamento.ts apps/server/src/financeiro/modelos/conta-receber.ts apps/server/src/financeiro/modelos/movimento.ts tests/financeiro/modelos.test.ts
git commit -m "feat: modelos Faturamento, ContaReceber, Movimento/Saldo"
```

---

### Task 4: Serviço LocalService — CRUD de Locais

**Arquivos:**
- Criar: `apps/server/src/financeiro/servicos/locais.ts`
- Criar: `tests/financeiro/servicos/locais.test.ts`

**Interfaces:**
- Consome: Banco, tipos Local, UUID
- Produz: `class LocalService { criar(pousada_id, nome) → Local; listar(pousada_id) → Local[]; atualizar(id, dados) → Local; }`

**Passos:**

- [ ] **Passo 1: Escrever testes para criar e listar locais**

```typescript
test("LocalService: criar local para pousada", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new LocalService(banco);
  
  const pousada_id = gerarUUID();
  const local = await servico.criar(pousada_id, "Pousada Principal");
  
  expect(local.pousada_id).toBe(pousada_id);
  expect(local.nome).toBe("Pousada Principal");
  expect(local.ativo).toBe(true);
  expect(local.parametros.local_padrao_hospedagem).toBeDefined();
});

test("LocalService: criar Local cria conta_bancaria padrão", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new LocalService(banco);
  
  const local = await servico.criar(gerarUUID(), "Sorveteria");
  
  // Verificar que ContaBancaria padrão foi criada
  const contas = await banco.todas(
    "SELECT * FROM fin_conta_bancaria WHERE local_id = ?",
    [local.id]
  );
  
  expect(contas.length).toBeGreaterThan(0);
});

test("LocalService: listar locais por pousada", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new LocalService(banco);
  
  const pousada_id = gerarUUID();
  const local1 = await servico.criar(pousada_id, "Pousada");
  const local2 = await servico.criar(pousada_id, "Sorveteria");
  
  const locais = await servico.listarPorPousada(pousada_id);
  
  expect(locais.length).toBe(2);
  expect(locais.map(l => l.nome)).toContain("Pousada");
  expect(locais.map(l => l.nome)).toContain("Sorveteria");
});
```

- [ ] **Passo 2: Executar teste para verificar falha**

Run: `npm test -- financeiro/servicos/locais.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar LocalService**

```typescript
export class LocalService {
  constructor(private banco: Banco) {}
  
  async criar(pousada_id: UUID, nome: string): Promise<Local> {
    const id = gerarUUID();
    const local_padrao_hospedagem = gerarUUID();
    const local_padrao_reserva = gerarUUID();
    
    await this.banco.executar(
      `INSERT INTO fin_local (id, pousada_id, nome, ativo, parametros)
       VALUES (?, ?, ?, 1, ?)`,
      [
        id,
        pousada_id,
        nome,
        JSON.stringify({
          local_padrao_hospedagem,
          local_padrao_reserva,
        }),
      ]
    );
    
    // Criar ContaBancaria padrão para o local
    await this.banco.executar(
      `INSERT INTO fin_conta_bancaria (id, local_id, nome, banco, agencia, numero, tipo, saldo_inicial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [gerarUUID(), id, "Caixa", "Sem banco", "0", "0", "corrente", "0"]
    );
    
    return this.obter(id);
  }
  
  async listarPorPousada(pousada_id: UUID): Promise<Local[]> {
    const linhas = await this.banco.todas(
      "SELECT * FROM fin_local WHERE pousada_id = ? ORDER BY nome",
      [pousada_id]
    );
    
    return linhas.map(this.mapearLocal);
  }
  
  async obter(id: UUID): Promise<Local> {
    const linha = await this.banco.um(
      "SELECT * FROM fin_local WHERE id = ?",
      [id]
    );
    
    if (!linha) throw new Erro.NãoEncontrado("Local não encontrado");
    
    return this.mapearLocal(linha);
  }
  
  private mapearLocal(linha: any): Local {
    return {
      id: linha.id,
      pousada_id: linha.pousada_id,
      nome: linha.nome,
      ativo: !!linha.ativo,
      parametros: JSON.parse(linha.parametros),
    };
  }
}
```

- [ ] **Passo 4: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/servicos/locais.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/servicos/locais.ts tests/financeiro/servicos/locais.test.ts
git commit -m "feat: LocalService — criar, listar, obter locais

Cada local é uma 'ilha' segregada com seus próprios lançamentos e contas bancárias."
```

---

### Task 5: LançamentoService — criar, cancelar, estornar

**Arquivos:**
- Criar: `apps/server/src/financeiro/servicos/lançamentos.ts`
- Criar: `tests/financeiro/servicos/lançamentos.test.ts`

**Interfaces:**
- Consome: Banco, tipos Lançamento, contrato de usuário (id, email, dispositivo)
- Produz: `class LançamentoService { criar(...) → Lançamento; cancelar(id, motivo, supervisor) → Lançamento; estornar(id, motivo, supervisor) → Lançamento; listar(local_id, filtros) → Lançamento[]; obter(id) → Lançamento; }`

**Passos:**

- [ ] **Passo 1: Escrever testes para criar e cancelar lançamento**

```typescript
test("LançamentoService: criar lançamento de recebimento", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new LançamentoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const lancamento = await servico.criar({
    local_id: gerarUUID(),
    data: new Date("2026-11-10"),
    tipo: "recebimento",
    origem: "hospedagem",
    valor: Dinheiro.de(500),
    forma_pagamento: "dinheiro",
    referencia_id: gerarUUID(),
    usuario,
  });
  
  expect(lancamento.status).toBe("confirmado");
  expect(lancamento.valor.centavos).toBe(50000);
  expect(lancamento.auditoria.criado_por).toBe(usuario.email);
});

test("LançamentoService: cancelar lançamento requer supervisor", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new LançamentoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const lancamento = await servico.criar({
    local_id: gerarUUID(),
    data: new Date(),
    tipo: "recebimento",
    origem: "manual",
    valor: Dinheiro.de(500),
    forma_pagamento: "dinheiro",
    referencia_id: null,
    usuario,
  });
  
  const cancelado = await servico.cancelar(
    lancamento.id,
    "Correção de valor",
    {supervisor_id: gerarUUID(), supervisor_email: "supervisor@test.com"},
    usuario
  );
  
  expect(cancelado.status).toBe("cancelado");
  expect(cancelado.auditoria.motivo_cancelamento).toBe("Correção de valor");
});

test("LançamentoService: cancelar sem supervisor lança erro", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new LançamentoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const lancamento = await servico.criar({...});
  
  expect(() => servico.cancelar(lancamento.id, "Motivo", null, usuario))
    .rejects.toThrow("Supervisor requerido");
});
```

- [ ] **Passo 2: Executar teste para verificar falha**

Run: `npm test -- financeiro/servicos/lançamentos.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar LançamentoService**

```typescript
export class LançamentoService {
  constructor(private banco: Banco) {}
  
  async criar(params: {
    local_id: UUID;
    data: Date;
    tipo: Lançamento["tipo"];
    origem: Lançamento["origem"];
    valor: Dinheiro;
    forma_pagamento: Lançamento["forma_pagamento"];
    referencia_id?: UUID;
    usuario: Usuário;
  }): Promise<Lançamento> {
    const id = gerarUUID();
    
    await this.banco.executar(
      `INSERT INTO fin_lancamento (
        id, local_id, data, tipo, origem, valor, forma_pagamento, status,
        referencia_id, criado_por, criado_em, dispositivo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.local_id,
        params.data,
        params.tipo,
        params.origem,
        params.valor.centavos,
        params.forma_pagamento,
        "confirmado",
        params.referencia_id || null,
        params.usuario.email,
        new Date(),
        params.usuario.dispositivo,
      ]
    );
    
    return this.obter(id);
  }
  
  async cancelar(
    id: UUID,
    motivo: string,
    supervisor: {supervisor_id: UUID; supervisor_email: string} | null,
    usuario: Usuário
  ): Promise<Lançamento> {
    if (!supervisor) throw new Erro.ValidacaoFalhou("Supervisor requerido para cancelar");
    
    await this.banco.executar(
      `UPDATE fin_lancamento 
       SET status = ?, motivo_cancelamento = ?, atualizado_por = ?, atualizado_em = ?
       WHERE id = ?`,
      ["cancelado", motivo, usuario.email, new Date(), id]
    );
    
    return this.obter(id);
  }
  
  async obter(id: UUID): Promise<Lançamento> {
    const linha = await this.banco.um(
      "SELECT * FROM fin_lancamento WHERE id = ?",
      [id]
    );
    
    if (!linha) throw new Erro.NãoEncontrado("Lançamento não encontrado");
    
    return {
      id: linha.id,
      local_id: linha.local_id,
      data: new Date(linha.data),
      tipo: linha.tipo,
      origem: linha.origem,
      valor: Dinheiro.de(linha.valor),
      forma_pagamento: linha.forma_pagamento,
      status: linha.status,
      referencia_id: linha.referencia_id,
      auditoria: {
        criado_por: linha.criado_por,
        data_criacao: new Date(linha.criado_em),
        dispositivo: linha.dispositivo,
        motivo_cancelamento: linha.motivo_cancelamento,
      },
    };
  }
  
  async listar(local_id: UUID, filtros?: {data_inicio?: Date; data_fim?: Date}): Promise<Lançamento[]> {
    let sql = "SELECT * FROM fin_lancamento WHERE local_id = ?";
    const params: any[] = [local_id];
    
    if (filtros?.data_inicio) {
      sql += " AND data >= ?";
      params.push(filtros.data_inicio);
    }
    
    if (filtros?.data_fim) {
      sql += " AND data <= ?";
      params.push(filtros.data_fim);
    }
    
    sql += " ORDER BY data DESC";
    
    const linhas = await this.banco.todas(sql, params);
    return linhas.map(this.mapear);
  }
  
  private mapear(linha: any): Lançamento {
    return {
      id: linha.id,
      local_id: linha.local_id,
      data: new Date(linha.data),
      tipo: linha.tipo,
      origem: linha.origem,
      valor: Dinheiro.de(linha.valor),
      forma_pagamento: linha.forma_pagamento,
      status: linha.status,
      referencia_id: linha.referencia_id,
      auditoria: {
        criado_por: linha.criado_por,
        data_criacao: new Date(linha.criado_em),
        dispositivo: linha.dispositivo,
        motivo_cancelamento: linha.motivo_cancelamento,
      },
    };
  }
}
```

- [ ] **Passo 4: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/servicos/lançamentos.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/servicos/lançamentos.ts tests/financeiro/servicos/lançamentos.test.ts
git commit -m "feat: LançamentoService — criar, cancelar, listar lançamentos

Auditoria completa: usuário, dispositivo, data, motivo (se ação sensível). Cancelamento requer supervisor."
```

---

### Task 6: CaixaBancoService — Movimentos, Saldos, Transferências

**Arquivos:**
- Criar: `apps/server/src/financeiro/servicos/caixa-banco.ts`
- Criar: `tests/financeiro/servicos/caixa-banco.test.ts`

**Interfaces:**
- Consome: Banco, LançamentoService, tipos Movimento, Saldo, ContaBancaria
- Produz: `class CaixaBancoService { criarMovimento(lancamento, conta) → Movimento; obterSaldo(conta_id, data) → Dinheiro; listarMovimentos(conta_id, periodo) → Movimento[]; transferir(origem, destino, valor, usuario) → {mov_origem, mov_destino}; }`

**Passos:**

- [ ] **Passo 1: Escrever testes para movimento, saldo, transferência**

```typescript
test("CaixaBancoService: criar movimento credito atualiza saldo", async () => {
  const banco = criarBancoEmMemoria();
  const caixa = new CaixaBancoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const conta_id = gerarUUID();
  const saldo_anterior = Dinheiro.de(10000);
  
  // Inserir saldo inicial
  await banco.executar(
    "INSERT INTO fin_saldo (id, conta_id, data, saldo) VALUES (?, ?, ?, ?)",
    [gerarUUID(), conta_id, new Date(), saldo_anterior.centavos]
  );
  
  const lancamento = {
    id: gerarUUID(),
    local_id: gerarUUID(),
    data: new Date(),
    tipo: "recebimento",
    origem: "hospedagem",
    valor: Dinheiro.de(500),
    forma_pagamento: "dinheiro",
    status: "confirmado",
  };
  
  const mov = await caixa.criarMovimento(lancamento, conta_id, usuario);
  
  expect(mov.tipo).toBe("credito");
  expect(mov.saldo_anterior.centavos).toBe(1000000);
  expect(mov.saldo_posterior.centavos).toBe(1050000);
});

test("CaixaBancoService: obter saldo em data específica", async () => {
  const banco = criarBancoEmMemoria();
  const caixa = new CaixaBancoService(banco);
  const conta_id = gerarUUID();
  
  // Inserir saldo histórico
  await banco.executar(
    "INSERT INTO fin_saldo (id, conta_id, data, saldo) VALUES (?, ?, ?, ?)",
    [gerarUUID(), conta_id, new Date("2026-11-10"), "1000000"] // R$ 10.000
  );
  
  const saldo = await caixa.obterSaldo(conta_id, new Date("2026-11-10"));
  
  expect(saldo.centavos).toBe(1000000);
});

test("CaixaBancoService: transferir entre contas cria 2 movimentos", async () => {
  const banco = criarBancoEmMemoria();
  const caixa = new CaixaBancoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const conta_origem_id = gerarUUID();
  const conta_destino_id = gerarUUID();
  
  // Inserir saldos
  await banco.executar(
    "INSERT INTO fin_saldo (id, conta_id, data, saldo) VALUES (?, ?, ?, ?)",
    [gerarUUID(), conta_origem_id, new Date(), "1000000"] // R$ 10.000
  );
  await banco.executar(
    "INSERT INTO fin_saldo (id, conta_id, data, saldo) VALUES (?, ?, ?, ?)",
    [gerarUUID(), conta_destino_id, new Date(), "500000"] // R$ 5.000
  );
  
  const resultado = await caixa.transferir(
    conta_origem_id,
    conta_destino_id,
    Dinheiro.de(300),
    usuario
  );
  
  expect(resultado.mov_origem.tipo).toBe("transferencia_out");
  expect(resultado.mov_destino.tipo).toBe("transferencia_in");
  expect(resultado.mov_origem.saldo_posterior.centavos).toBe(970000); // 10.000 - 300
  expect(resultado.mov_destino.saldo_posterior.centavos).toBe(530000); // 5.000 + 300
});
```

- [ ] **Passo 2: Executar teste para verificar falha**

Run: `npm test -- financeiro/servicos/caixa-banco.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar CaixaBancoService**

```typescript
export class CaixaBancoService {
  constructor(private banco: Banco) {}
  
  async criarMovimento(
    lancamento: Lançamento,
    conta_id: UUID,
    usuario: Usuário
  ): Promise<Movimento> {
    const saldo_anterior = await this.obterSaldo(conta_id, lancamento.data);
    
    const tipo = lancamento.tipo === "recebimento" ? "credito" : "debito";
    const valor_movimento = lancamento.tipo === "recebimento"
      ? lancamento.valor
      : lancamento.valor.negarPara(-lancamento.valor.centavos);
    
    const saldo_posterior = new Dinheiro(
      saldo_anterior.centavos + (tipo === "credito" ? lancamento.valor.centavos : -lancamento.valor.centavos)
    );
    
    const mov_id = gerarUUID();
    
    await this.banco.executar(
      `INSERT INTO fin_movimento (
        id, local_id, conta_id, lancamento_id, tipo, valor, saldo_anterior, saldo_posterior, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mov_id,
        lancamento.local_id,
        conta_id,
        lancamento.id,
        tipo,
        lancamento.valor.centavos,
        saldo_anterior.centavos,
        saldo_posterior.centavos,
        lancamento.data,
      ]
    );
    
    // Criar/atualizar saldo
    await this.banco.executar(
      `INSERT OR REPLACE INTO fin_saldo (id, conta_id, data, saldo)
       VALUES (?, ?, ?, ?)`,
      [gerarUUID(), conta_id, lancamento.data, saldo_posterior.centavos]
    );
    
    return this.obterMovimento(mov_id);
  }
  
  async obterSaldo(conta_id: UUID, data: Date): Promise<Dinheiro> {
    const linha = await this.banco.um(
      `SELECT saldo FROM fin_saldo WHERE conta_id = ? AND data <= ? ORDER BY data DESC LIMIT 1`,
      [conta_id, data]
    );
    
    return Dinheiro.de(linha?.saldo || 0);
  }
  
  async listarMovimentos(conta_id: UUID, data_inicio: Date, data_fim: Date): Promise<Movimento[]> {
    const linhas = await this.banco.todas(
      `SELECT * FROM fin_movimento WHERE conta_id = ? AND data BETWEEN ? AND ? ORDER BY data DESC`,
      [conta_id, data_inicio, data_fim]
    );
    
    return linhas.map(this.mapear);
  }
  
  async transferir(
    conta_origem_id: UUID,
    conta_destino_id: UUID,
    valor: Dinheiro,
    usuario: Usuário
  ): Promise<{mov_origem: Movimento; mov_destino: Movimento}> {
    const lancamento_id = gerarUUID();
    
    // Criar lançamento de transferência (genérico)
    await this.banco.executar(
      `INSERT INTO fin_lancamento (
        id, local_id, data, tipo, origem, valor, forma_pagamento, status,
        criado_por, criado_em, dispositivo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lancamento_id,
        null, // local será determinado pela conta?
        new Date(),
        "transferencia",
        "manual",
        valor.centavos,
        "transferencia",
        "confirmado",
        usuario.email,
        new Date(),
        usuario.dispositivo,
      ]
    );
    
    // Criar movimento de débito na origem
    const saldo_origem_antes = await this.obterSaldo(conta_origem_id, new Date());
    const saldo_origem_depois = new Dinheiro(saldo_origem_antes.centavos - valor.centavos);
    
    const mov_origem_id = gerarUUID();
    await this.banco.executar(
      `INSERT INTO fin_movimento (
        id, conta_id, lancamento_id, tipo, valor, saldo_anterior, saldo_posterior, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [mov_origem_id, conta_origem_id, lancamento_id, "transferencia_out", valor.centavos, saldo_origem_antes.centavos, saldo_origem_depois.centavos, new Date()]
    );
    
    // Criar movimento de crédito no destino
    const saldo_destino_antes = await this.obterSaldo(conta_destino_id, new Date());
    const saldo_destino_depois = new Dinheiro(saldo_destino_antes.centavos + valor.centavos);
    
    const mov_destino_id = gerarUUID();
    await this.banco.executar(
      `INSERT INTO fin_movimento (
        id, conta_id, lancamento_id, tipo, valor, saldo_anterior, saldo_posterior, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [mov_destino_id, conta_destino_id, lancamento_id, "transferencia_in", valor.centavos, saldo_destino_antes.centavos, saldo_destino_depois.centavos, new Date()]
    );
    
    return {
      mov_origem: await this.obterMovimento(mov_origem_id),
      mov_destino: await this.obterMovimento(mov_destino_id),
    };
  }
  
  private async obterMovimento(id: UUID): Promise<Movimento> {
    const linha = await this.banco.um("SELECT * FROM fin_movimento WHERE id = ?", [id]);
    return this.mapear(linha);
  }
  
  private mapear(linha: any): Movimento {
    return {
      id: linha.id,
      local_id: linha.local_id,
      conta_id: linha.conta_id,
      lançamento_id: linha.lancamento_id,
      tipo: linha.tipo,
      valor: Dinheiro.de(linha.valor),
      saldo_anterior: Dinheiro.de(linha.saldo_anterior),
      saldo_posterior: Dinheiro.de(linha.saldo_posterior),
      data: new Date(linha.data),
    };
  }
}
```

- [ ] **Passo 4: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/servicos/caixa-banco.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/servicos/caixa-banco.ts tests/financeiro/servicos/caixa-banco.test.ts
git commit -m "feat: CaixaBancoService — movimentos, saldos, transferências

Consolida movimentos de dinheiro/PIX em contas bancárias. Rastreia saldos históricos. Transferências entre contas criam 2 movimentos."
```

---

### Task 7: FaturamentoService e ContasReceberService

**Arquivos:**
- Criar: `apps/server/src/financeiro/servicos/faturamento.ts`
- Criar: `apps/server/src/financeiro/servicos/contas-receber.ts`
- Criar: `tests/financeiro/servicos/faturamento.test.ts`
- Criar: `tests/financeiro/servicos/contas-receber.test.ts`

**Interfaces:**
- Consome: Banco, LançamentoService, CaixaBancoService, tipos Faturamento, ContaReceber, Cliente
- Produz: `class FaturamentoService { criarParaCheckout(checkout_id, cliente_id, valor, usuario) → Faturamento; gerarCobranca(faturamento_id, forma, usuario) → Faturamento; }` + `class ContasReceberService { criarRecebivel(faturamento_id, ...) → ContaReceber; confirmarPagamento(recebivel_id, valor, conta_bancaria, usuario) → ContaReceber; }`

**Passos:**

- [ ] **Passo 1: Escrever testes para Faturamento e ContaReceber**

```typescript
test("FaturamentoService: criar faturamento para checkout", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new FaturamentoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const fat = await servico.criarParaCheckout({
    checkout_id: gerarUUID(),
    cliente_id: gerarUUID(),
    local_id: gerarUUID(),
    valor_original: Dinheiro.de(1000),
    usuario,
  });
  
  expect(fat.status).toBe("aberto");
  expect(fat.valor_liquido.centavos).toBe(100000);
});

test("FaturamentoService: gerar cobrança boleto", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new FaturamentoService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const fat = await servico.criarParaCheckout({
    checkout_id: gerarUUID(),
    cliente_id: gerarUUID(),
    local_id: gerarUUID(),
    valor_original: Dinheiro.de(1000),
    usuario,
  });
  
  const atualizado = await servico.gerarCobranca(fat.id, "boleto", usuario);
  
  expect(atualizado.forma_cobranca).toBe("boleto");
  expect(atualizado.numero_documento).toMatch(/FAT-\d+/);
});

test("ContasReceberService: criar recebível a partir de faturamento", async () => {
  const banco = criarBancoEmMemoria();
  const servico = new ContasReceberService(banco);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const fat_id = gerarUUID();
  
  const receber = await servico.criarRecebivel({
    faturamento_id: fat_id,
    cliente_id: gerarUUID(),
    local_id: gerarUUID(),
    numero_documento: "FAT-00001",
    valor_original: Dinheiro.de(1000),
    data_vencimento: new Date("2026-12-10"),
    usuario,
  });
  
  expect(receber.status).toBe("pendente");
  expect(receber.valor_recebido.centavos).toBe(0);
});

test("ContasReceberService: confirmar pagamento de recebível", async () => {
  const banco = criarBancoEmMemoria();
  const caixa = new CaixaBancoService(banco);
  const servico = new ContasReceberService(banco, caixa);
  const usuario = {id: gerarUUID(), email: "user@test.com", dispositivo: "web"};
  
  const receber = await servico.criarRecebivel({
    faturamento_id: gerarUUID(),
    cliente_id: gerarUUID(),
    local_id: gerarUUID(),
    numero_documento: "FAT-00001",
    valor_original: Dinheiro.de(1000),
    data_vencimento: new Date("2026-12-10"),
    usuario,
  });
  
  const conta_id = gerarUUID();
  const confirmado = await servico.confirmarPagamento({
    recebivel_id: receber.id,
    valor: Dinheiro.de(1000),
    conta_bancaria_id: conta_id,
    usuario,
  });
  
  expect(confirmado.status).toBe("recebido");
  expect(confirmado.valor_recebido.centavos).toBe(100000);
});
```

- [ ] **Passo 2: Executar testes para verificar falha**

Run: `npm test -- financeiro/servicos/faturamento.test.ts financeiro/servicos/contas-receber.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar FaturamentoService e ContasReceberService**

(Similar às tasks anteriores: inserir no banco, mapear resultados, expor métodos)

- [ ] **Passo 4: Rodar testes para verificar sucesso**

Run: `npm test -- financeiro/servicos/faturamento.test.ts financeiro/servicos/contas-receber.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/servicos/faturamento.ts apps/server/src/financeiro/servicos/contas-receber.ts tests/financeiro/servicos/*.test.ts
git commit -m "feat: FaturamentoService e ContasReceberService

Faturamento: criar para checkouts, gerar cobrança (boleto/PIX/depósito).
ContaReceber: rastrear recebiveis, confirmar pagamentos, atualizar saldo."
```

---

### Task 8: Consumidores de Eventos — Hospedagem Checkout e Reserva Sinal

**Arquivos:**
- Criar: `apps/server/src/financeiro/consumidores-eventos/hospedagem-checkout.ts`
- Criar: `apps/server/src/financeiro/consumidores-eventos/reserva-sinal.ts`
- Criar: `tests/financeiro/integracao/eventos.test.ts`

**Interfaces:**
- Consome: Barramento (eventos), LançamentoService, CaixaBancoService, FaturamentoService, ContasReceberService
- Produz: consumidores registrados no barramento que processam eventos e criam lançamentos

**Passos:**

- [ ] **Passo 1: Escrever teste de integração — checkout finalizado gera lançamentos**

```typescript
test("Integração: CheckoutFinalizado → Lançamentos em Caixa/Banco", async () => {
  const banco = criarBancoEmMemoria();
  const lancSvc = new LançamentoService(banco);
  const caixaSvc = new CaixaBancoService(banco);
  const consumidor = new ConsumidorCheckoutHospedagem(lancSvc, caixaSvc);
  
  const evento = {
    id: gerarUUID(),
    checkout_id: gerarUUID(),
    cliente_id: gerarUUID(),
    valor_total: Dinheiro.de(500),
    tipo_saida: "pago",
    pagamentos: [
      {forma: "dinheiro", valor: Dinheiro.de(300)},
      {forma: "pix", valor: Dinheiro.de(200)},
    ],
    local_id: gerarUUID(),
    timestamp: new Date(),
  };
  
  await consumidor.processar(evento);
  
  // Verificar lançamentos criados
  const lançamentos = await lancSvc.listar(evento.local_id);
  expect(lançamentos.length).toBe(2);
  expect(lançamentos[0].valor.centavos).toBe(30000); // R$ 300
  expect(lançamentos[1].valor.centavos).toBe(20000); // R$ 200
});

test("Integração: CheckoutFinalizado tipo 'faturado' → Faturamento + ContaReceber", async () => {
  const banco = criarBancoEmMemoria();
  const lancSvc = new LançamentoService(banco);
  const fatSvc = new FaturamentoService(banco);
  const receberSvc = new ContasReceberService(banco);
  const consumidor = new ConsumidorCheckoutHospedagem(lancSvc, fatSvc, receberSvc);
  
  const evento = {
    id: gerarUUID(),
    checkout_id: gerarUUID(),
    cliente_id: gerarUUID(),
    valor_total: Dinheiro.de(1000),
    tipo_saida: "faturado",
    pagamentos: [],
    local_id: gerarUUID(),
    timestamp: new Date(),
  };
  
  await consumidor.processar(evento);
  
  // Verificar Faturamento criado
  const faturamentos = await fatSvc.listar(evento.local_id);
  expect(faturamentos.length).toBe(1);
  expect(faturamentos[0].status).toBe("aberto");
  
  // Verificar ContaReceber criado
  const recebiveis = await receberSvc.listar(evento.local_id);
  expect(recebiveis.length).toBe(1);
});

test("Integração: SinalReservaRecebido → Lançamento em Caixa", async () => {
  const banco = criarBancoEmMemoria();
  const lancSvc = new LançamentoService(banco);
  const caixaSvc = new CaixaBancoService(banco);
  const consumidor = new ConsumidorReservaSinal(lancSvc, caixaSvc);
  
  const evento = {
    id: gerarUUID(),
    reserva_id: gerarUUID(),
    cliente_id: gerarUUID(),
    valor: Dinheiro.de(200),
    forma_pagamento: "pix",
    local_id: gerarUUID(),
    timestamp: new Date(),
  };
  
  await consumidor.processar(evento);
  
  const lançamentos = await lancSvc.listar(evento.local_id);
  expect(lançamentos.length).toBe(1);
  expect(lançamentos[0].origem).toBe("reserva");
  expect(lançamentos[0].valor.centavos).toBe(20000);
});
```

- [ ] **Passo 2: Executar testes para verificar falha**

Run: `npm test -- financeiro/integracao/eventos.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar consumidores de eventos**

```typescript
// consumidores-eventos/hospedagem-checkout.ts
export class ConsumidorCheckoutHospedagem {
  constructor(
    private lancamento: LançamentoService,
    private caixa: CaixaBancoService,
    private faturamento: FaturamentoService,
    private contasReceber: ContasReceberService
  ) {}
  
  async processar(evento: CheckoutFinalizado) {
    const usuario = {id: "SISTEMA", email: "sistema", dispositivo: "servidor"};
    
    // Criar lançamentos para cada pagamento
    for (const pagamento of evento.pagamentos) {
      const lancamento = await this.lancamento.criar({
        local_id: evento.local_id,
        data: evento.timestamp,
        tipo: "recebimento",
        origem: "hospedagem",
        valor: pagamento.valor,
        forma_pagamento: pagamento.forma,
        referencia_id: evento.checkout_id,
        usuario,
      });
      
      // Rotear para Caixa ou Cartão
      if (pagamento.forma in ["dinheiro", "pix"]) {
        const conta_padrao = await this.obterContaPadraoLocal(evento.local_id);
        await this.caixa.criarMovimento(lancamento, conta_padrao.id, usuario);
      } else if (pagamento.forma in ["debito", "credito"]) {
        // Futuro: CartaoService
      }
    }
    
    // Se faturado, criar Faturamento + ContaReceber
    if (evento.tipo_saida === "faturado") {
      const faturamento = await this.faturamento.criarParaCheckout({
        checkout_id: evento.checkout_id,
        cliente_id: evento.cliente_id,
        local_id: evento.local_id,
        valor_original: evento.valor_total,
        usuario,
      });
      
      await this.contasReceber.criarRecebivel({
        faturamento_id: faturamento.id,
        cliente_id: evento.cliente_id,
        local_id: evento.local_id,
        numero_documento: faturamento.numero_documento,
        valor_original: faturamento.valor_liquido,
        data_vencimento: adicionarDias(new Date(), 30),
        usuario,
      });
    }
  }
  
  private async obterContaPadraoLocal(local_id: UUID): Promise<ContaBancaria> {
    // Lógica para obter conta padrão do local
  }
}

// consumidores-eventos/reserva-sinal.ts
export class ConsumidorReservaSinal {
  constructor(
    private lancamento: LançamentoService,
    private caixa: CaixaBancoService
  ) {}
  
  async processar(evento: SinalReservaRecebido) {
    const usuario = {id: "SISTEMA", email: "sistema", dispositivo: "servidor"};
    
    const lancamento = await this.lancamento.criar({
      local_id: evento.local_id,
      data: evento.timestamp,
      tipo: "recebimento",
      origem: "reserva",
      valor: evento.valor,
      forma_pagamento: evento.forma_pagamento,
      referencia_id: evento.reserva_id,
      usuario,
    });
    
    if (evento.forma_pagamento in ["dinheiro", "pix"]) {
      const conta_padrao = await this.obterContaPadraoLocal(evento.local_id);
      await this.caixa.criarMovimento(lancamento, conta_padrao.id, usuario);
    }
  }
  
  private async obterContaPadraoLocal(local_id: UUID): Promise<ContaBancaria> {
    // Lógica para obter conta padrão do local
  }
}
```

Registrar consumidores no barramento (em `http/app.ts` ou `infra/barramento.ts`):

```typescript
const consumidor_checkout = new ConsumidorCheckoutHospedagem(...);
barramento.inscrever("hospedagem.CheckoutFinalizado", async (evento) => {
  await consumidor_checkout.processar(evento);
});

const consumidor_sinal = new ConsumidorReservaSinal(...);
barramento.inscrever("reserva.SinalReservaRecebido", async (evento) => {
  await consumidor_sinal.processar(evento);
});
```

- [ ] **Passo 4: Rodar testes para verificar sucesso**

Run: `npm test -- financeiro/integracao/eventos.test.ts`
Esperado: PASS

- [ ] **Passo 5: Commit**

```bash
git add apps/server/src/financeiro/consumidores-eventos/*.ts tests/financeiro/integracao/eventos.test.ts
git commit -m "feat: consumidores de eventos — Hospedagem e Reserva

CheckoutFinalizado → Lançamentos automáticos roteados para Caixa ou Faturamento.
SinalReservaRecebido → Lançamentos em Caixa.
Integração completa via barramento de eventos."
```

---

### Task 9: Rotas HTTP — Lançamentos, Faturamento, Contas a Receber, Caixa

**Arquivos:**
- Criar: `apps/server/src/financeiro/rotas/lançamentos.ts`
- Criar: `apps/server/src/financeiro/rotas/faturamento.ts`
- Criar: `apps/server/src/financeiro/rotas/contas-receber.ts`
- Criar: `apps/server/src/financeiro/rotas/caixa-banco.ts`
- Modificar: `apps/server/src/financeiro/rotas.ts` (agregador)
- Criar: `tests/financeiro/rotas.test.ts`

**Interfaces:**
- Consome: Express, serviços (LançamentoService, etc), autenticação, autorização
- Produz: endpoints RESTful

**Passos:**

- [ ] **Passo 1: Escrever testes para rotas HTTP**

```typescript
test("GET /financeiro/lançamentos — lista lançamentos do local", async () => {
  const app = criarAppComFinanceiro();
  const token = gerarTokenAutenticado();
  
  const res = await request(app)
    .get("/financeiro/lançamentos?local_id=...")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  
  expect(res.body).toHaveProperty("lançamentos");
  expect(Array.isArray(res.body.lançamentos)).toBe(true);
});

test("POST /financeiro/faturamento/gerar-cobrança — gera cobrança boleto", async () => {
  const app = criarAppComFinanceiro();
  const token = gerarTokenAutenticado();
  
  const res = await request(app)
    .post("/financeiro/faturamento/gerar-cobrança")
    .set("Authorization", `Bearer ${token}`)
    .send({
      faturamento_id: "...",
      forma: "boleto",
    })
    .expect(200);
  
  expect(res.body).toHaveProperty("numero_documento");
});

test("PUT /financeiro/contas-receber/:id/confirmar-pagamento", async () => {
  const app = criarAppComFinanceiro();
  const token = gerarTokenAutenticado();
  
  const res = await request(app)
    .put("/financeiro/contas-receber/...:id/confirmar-pagamento")
    .set("Authorization", `Bearer ${token}`)
    .send({
      valor: 100000,
      conta_bancaria_id: "...",
    })
    .expect(200);
  
  expect(res.body.status).toBe("recebido");
});

test("POST /financeiro/caixa-banco/transferência — transferir entre contas", async () => {
  const app = criarAppComFinanceiro();
  const token = gerarTokenAutenticado();
  
  const res = await request(app)
    .post("/financeiro/caixa-banco/transferência")
    .set("Authorization", `Bearer ${token}`)
    .send({
      conta_origem_id: "...",
      conta_destino_id: "...",
      valor: 100000,
    })
    .expect(200);
  
  expect(res.body).toHaveProperty("mov_origem");
  expect(res.body).toHaveProperty("mov_destino");
});
```

- [ ] **Passo 2: Executar testes para verificar falha**

Run: `npm test -- financeiro/rotas.test.ts`
Esperado: FAIL (rotas não existem)

- [ ] **Passo 3: Implementar rotas**

```typescript
// rotas/lançamentos.ts
export function rotasLançamentos(router: Express.Router, svc: LançamentoService) {
  router.get("/lançamentos", autenticado, async (req, res) => {
    const {local_id, data_inicio, data_fim} = req.query;
    
    const lançamentos = await svc.listar(local_id, {
      data_inicio: data_inicio ? new Date(data_inicio) : undefined,
      data_fim: data_fim ? new Date(data_fim) : undefined,
    });
    
    res.json({lançamentos});
  });
  
  router.delete("/lançamentos/:id", autenticado, sensivelComSupervisor, async (req, res) => {
    const {id} = req.params;
    const {motivo} = req.body;
    const usuario = req.usuario;
    const supervisor = req.supervisor;
    
    const cancelado = await svc.cancelar(id, motivo, supervisor, usuario);
    
    res.json(cancelado);
  });
}

// rotas/faturamento.ts
export function rotasFaturamento(router: Express.Router, svc: FaturamentoService) {
  router.post("/faturamento/gerar-cobrança", autenticado, async (req, res) => {
    const {faturamento_id, forma} = req.body;
    const usuario = req.usuario;
    
    const atualizado = await svc.gerarCobranca(faturamento_id, forma, usuario);
    
    res.json(atualizado);
  });
}

// (similar para contas-receber e caixa-banco)

// rotas.ts (agregador)
export function rotasFinanceiro(app: Express.Application, db: Banco) {
  const router = express.Router();
  const lancSvc = new LançamentoService(db);
  const fatSvc = new FaturamentoService(db);
  const receberSvc = new ContasReceberService(db);
  const caixaSvc = new CaixaBancoService(db);
  
  rotasLançamentos(router, lancSvc);
  rotasFaturamento(router, fatSvc);
  rotasContasReceber(router, receberSvc);
  rotasCaixaBanco(router, caixaSvc);
  
  app.use("/financeiro", router);
}
```

- [ ] **Passo 4: Rodar testes para verificar sucesso**

Run: `npm test -- financeiro/rotas.test.ts`
Esperado: PASS

- [ ] **Passo 5: Integrar rotas em `http/app.ts`**

```typescript
// No app.ts, onde outras rotas são registradas:
import {rotasFinanceiro} from "../financeiro/rotas";

rotasFinanceiro(app, banco);
```

- [ ] **Passo 6: Commit**

```bash
git add apps/server/src/financeiro/rotas/*.ts tests/financeiro/rotas.test.ts
git commit -m "feat: rotas HTTP para Financeiro

GET /financeiro/lançamentos, POST /financeiro/faturamento/gerar-cobrança, PUT /contas-receber/:id/confirmar-pagamento, POST /caixa-banco/transferência."
```

---

### Task 10: Relatórios MVP — Fluxo de Caixa, Contas a Receber, Movimento, Consolidado

**Arquivos:**
- Criar: `apps/server/src/financeiro/relatórios/fluxo-caixa.ts`
- Criar: `apps/server/src/financeiro/relatórios/contas-receber.ts`
- Criar: `apps/server/src/financeiro/relatórios/movimento.ts`
- Criar: `apps/server/src/financeiro/relatórios/consolidado.ts`
- Criar: `apps/server/src/financeiro/rotas/relatórios.ts`
- Criar: `tests/financeiro/relatórios.test.ts`

**Interfaces:**
- Consome: Banco, tipos (Movimento, Saldo, ContaReceber, etc)
- Produz: `class RelatorioFluxoCaixa { gerar(local_id, data) → {saldo_inicial, entradas, saídas, saldo_final}; }` etc

**Passos:**

- [ ] **Passo 1: Escrever testes para relatórios**

```typescript
test("RelatorioFluxoCaixa: gerar para dia específico", async () => {
  const banco = criarBancoEmMemoria();
  const relatorio = new RelatorioFluxoCaixa(banco);
  
  const resultado = await relatorio.gerar(local_id, new Date("2026-11-10"));
  
  expect(resultado).toHaveProperty("saldo_inicial");
  expect(resultado).toHaveProperty("entradas");
  expect(resultado).toHaveProperty("saídas");
  expect(resultado).toHaveProperty("saldo_final");
  expect(resultado.saldo_final.centavos).toBe(
    resultado.saldo_inicial.centavos + resultado.entradas.centavos - resultado.saídas.centavos
  );
});

test("RelatorioContasReceber: posição de recebiveis", async () => {
  const banco = criarBancoEmMemoria();
  const relatorio = new RelatorioContasReceber(banco);
  
  const resultado = await relatorio.gerar(local_id);
  
  expect(resultado).toHaveProperty("aberto");
  expect(resultado).toHaveProperty("vencido");
  expect(resultado).toHaveProperty("parcialmente_recebido");
  expect(resultado).toHaveProperty("total_pendente");
});

test("RelatorioConsolidado: saldos por local", async () => {
  const banco = criarBancoEmMemoria();
  const relatorio = new RelatorioConsolidado(banco);
  
  const resultado = await relatorio.gerar(new Date("2026-11-10"));
  
  expect(Array.isArray(resultado.locais)).toBe(true);
  expect(resultado).toHaveProperty("total");
});
```

- [ ] **Passo 2: Executar testes para verificar falha**

Run: `npm test -- financeiro/relatórios.test.ts`
Esperado: FAIL

- [ ] **Passo 3: Implementar relatórios**

```typescript
// relatórios/fluxo-caixa.ts
export class RelatorioFluxoCaixa {
  constructor(private banco: Banco) {}
  
  async gerar(local_id: UUID, data: Date): Promise<RelatorioFluxoCaixaDia> {
    // Obter saldo inicial (dia anterior)
    const saldo_anterior = await this.obterSaldoDia(local_id, new Date(data.getTime() - 24*60*60*1000));
    
    // Somar créditos do dia
    const entradas = await this.banco.um(
      `SELECT SUM(valor) as total FROM fin_movimento
       WHERE local_id = ? AND data = ? AND tipo IN ('credito', 'transferencia_in')`,
      [local_id, data]
    );
    
    // Somar débitos do dia
    const saídas = await this.banco.um(
      `SELECT SUM(valor) as total FROM fin_movimento
       WHERE local_id = ? AND data = ? AND tipo IN ('debito', 'transferencia_out')`,
      [local_id, data]
    );
    
    const entradas_valor = entradas?.total ? Dinheiro.de(entradas.total) : Dinheiro.de(0);
    const saídas_valor = saídas?.total ? Dinheiro.de(saídas.total) : Dinheiro.de(0);
    
    const saldo_final = new Dinheiro(
      saldo_anterior.centavos + entradas_valor.centavos - saídas_valor.centavos
    );
    
    return {
      data,
      saldo_inicial: saldo_anterior,
      entradas: entradas_valor,
      saídas: saídas_valor,
      saldo_final,
    };
  }
  
  private async obterSaldoDia(local_id: UUID, data: Date): Promise<Dinheiro> {
    const linha = await this.banco.um(
      `SELECT saldo FROM fin_saldo WHERE local_id = ? AND data <= ? ORDER BY data DESC LIMIT 1`,
      [local_id, data]
    );
    
    return Dinheiro.de(linha?.saldo || 0);
  }
}

// relatórios/contas-receber.ts
export class RelatorioContasReceber {
  constructor(private banco: Banco) {}
  
  async gerar(local_id: UUID): Promise<RelatorioContasReceberPosicao> {
    const hoje = new Date();
    
    const aberto = await this.banco.todas(
      `SELECT * FROM fin_conta_receber
       WHERE local_id = ? AND status = 'pendente' AND data_vencimento > ?
       ORDER BY data_vencimento`,
      [local_id, hoje]
    );
    
    const vencido = await this.banco.todas(
      `SELECT * FROM fin_conta_receber
       WHERE local_id = ? AND status = 'pendente' AND data_vencimento <= ?
       ORDER BY data_vencimento`,
      [local_id, hoje]
    );
    
    const parcialmente_recebido = await this.banco.todas(
      `SELECT * FROM fin_conta_receber
       WHERE local_id = ? AND status = 'parcialmente_recebido'`,
      [local_id]
    );
    
    const total_aberto = this.somar(aberto.map(r => r.valor_original - r.valor_recebido));
    const total_vencido = this.somar(vencido.map(r => r.valor_original - r.valor_recebido));
    const total_parcial = this.somar(parcialmente_recebido.map(r => r.valor_original - r.valor_recebido));
    
    return {
      aberto: {itens: aberto, total: total_aberto},
      vencido: {itens: vencido, total: total_vencido},
      parcialmente_recebido: {itens: parcialmente_recebido, total: total_parcial},
      total_pendente: new Dinheiro(total_aberto.centavos + total_vencido.centavos + total_parcial.centavos),
    };
  }
  
  private somar(valores: Dinheiro[]): Dinheiro {
    return new Dinheiro(valores.reduce((acc, v) => acc + v.centavos, 0));
  }
}

// (similar para movimento e consolidado)
```

- [ ] **Passo 4: Criar rotas para relatórios**

```typescript
// rotas/relatórios.ts
export function rotasRelatórios(router: Express.Router) {
  router.get("/relatórios/fluxo-caixa", autenticado, async (req, res) => {
    const {local_id, data} = req.query;
    
    const relatorio = new RelatorioFluxoCaixa(req.banco);
    const resultado = await relatorio.gerar(local_id, new Date(data));
    
    res.json(resultado);
  });
  
  router.get("/relatórios/contas-receber", autenticado, async (req, res) => {
    const {local_id} = req.query;
    
    const relatorio = new RelatorioContasReceber(req.banco);
    const resultado = await relatorio.gerar(local_id);
    
    res.json(resultado);
  });
  
  // (similar para movimento e consolidado)
}
```

- [ ] **Passo 5: Rodar testes para verificar sucesso**

Run: `npm test -- financeiro/relatórios.test.ts`
Esperado: PASS

- [ ] **Passo 6: Commit**

```bash
git add apps/server/src/financeiro/relatórios/*.ts apps/server/src/financeiro/rotas/relatórios.ts tests/financeiro/relatórios.test.ts
git commit -m "feat: relatórios MVP — Fluxo Caixa, Contas a Receber, Movimento, Consolidado

5 relatórios essenciais para operação diária do Financeiro."
```

---

### Task 11: Testes E2E — Fluxo Completo Offline + Sincronização

**Arquivos:**
- Criar: `tests/financeiro/e2e/fluxo-completo.test.ts`

**Interfaces:**
- Consome: app completa, banco local, banco nuvem (simulado), eventos
- Produz: teste de ponta a ponta validando: checkout → lançamentos → saldos corretos → offline contínua → reconecta → sincronização precisa

**Passos:**

- [ ] **Passo 1: Escrever teste E2E — hospedagem completa + sinal + financeiro**

```typescript
test("E2E: Hospedagem + Reserva + Financeiro — offline e sincronização", async () => {
  const appLocal = criarAppComTodosModulos();
  const bancoLocal = appLocal.banco;
  const bancoNuvem = criarBancoNuvemSimulado();
  
  // ──── FASE 1: OPERAÇÃO ONLINE ────
  
  // Criar reserva com sinal (PIX)
  const reservaRes = await request(appLocal)
    .post("/reservas")
    .send({
      cliente_id: "cli-001",
      categoria_id: "cat-001",
      data_chegada: "2026-11-15",
      data_saida: "2026-11-17",
      valor_sinal: 20000, // R$ 200
      forma_pagamento: "pix",
    });
  
  expect(reservaRes.status).toBe(201);
  const reserva_id = reservaRes.body.id;
  
  // Sistema deve ter criado lançamento no Financeiro
  const lancamentosAposSinal = await request(appLocal)
    .get("/financeiro/lançamentos?local_id=default")
    .expect(200);
  
  expect(lancamentosAposSinal.body.lançamentos.length).toBe(1);
  expect(lancamentosAposSinal.body.lançamentos[0].origem).toBe("reserva");
  expect(lancamentosAposSinal.body.lançamentos[0].valor.centavos).toBe(20000);
  
  // Verificar saldo em Caixa/Banco
  const saldoAposSinal = await request(appLocal)
    .get("/financeiro/caixa-banco/saldo?local_id=default&data=today")
    .expect(200);
  
  expect(saldoAposSinal.body.saldo.centavos).toBeGreaterThan(0);
  
  // Fazer check-in e check-out
  const checkoutRes = await request(appLocal)
    .post("/hospedagem/checkout")
    .send({
      reserva_id,
      tipo_saida: "pago",
      pagamentos: [
        {forma: "dinheiro", valor: 50000}, // R$ 500
      ],
      sinal_pago: 20000, // abate do sinal pago
    });
  
  expect(checkoutRes.status).toBe(200);
  
  // Sistema deve ter criado 2º lançamento no Financeiro
  const lancamentosAposCheckout = await request(appLocal)
    .get("/financeiro/lançamentos?local_id=default")
    .expect(200);
  
  expect(lancamentosAposCheckout.body.lançamentos.length).toBe(2);
  expect(lancamentosAposCheckout.body.lançamentos[0].origem).toBe("hospedagem");
  
  // Saldo deve ter aumentado
  const saldoAposCheckout = await request(appLocal)
    .get("/financeiro/caixa-banco/saldo?local_id=default&data=today")
    .expect(200);
  
  expect(saldoAposCheckout.body.saldo.centavos).toBeGreaterThan(saldoAposSinal.body.saldo.centavos);
  
  // ──── FASE 2: DESCONECTAR INTERNET (simular offline) ────
  
  appLocal.conectado = false;
  
  // Criar nova reserva offline
  const reserva2Res = await request(appLocal)
    .post("/reservas")
    .send({
      cliente_id: "cli-002",
      categoria_id: "cat-001",
      data_chegada: "2026-11-18",
      data_saida: "2026-11-19",
      valor_sinal: 30000,
      forma_pagamento: "dinheiro",
    });
  
  expect(reserva2Res.status).toBe(201);
  
  // Lançamento criado localmente mesmo offline
  const lancamentosOffline = await request(appLocal)
    .get("/financeiro/lançamentos?local_id=default")
    .expect(200);
  
  expect(lancamentosOffline.body.lançamentos.length).toBe(3);
  
  // Verificar Outbox tem evento pendente
  const outboxStatus = await request(appLocal)
    .get("/diagnostico/sincronização")
    .expect(200);
  
  expect(outboxStatus.body.eventos_pendentes).toBeGreaterThan(0);
  
  // ──── FASE 3: RECONECTAR À INTERNET ────
  
  appLocal.conectado = true;
  appLocal.nuvem = bancoNuvem; // Apontar para nuvem
  
  // Disparar sincronização
  await appLocal.sincronizador.sincronizar();
  
  // Verificar que nuvem recebeu todos os eventos
  const lancamentosNuvem = await bancoNuvem.todas(
    "SELECT COUNT(*) as total FROM fin_lancamento"
  );
  
  expect(lancamentosNuvem[0].total).toBe(3);
  
  // Verificar Outbox local limpo
  const outboxPosSync = await request(appLocal)
    .get("/diagnostico/sincronização")
    .expect(200);
  
  expect(outboxPosSync.body.eventos_pendentes).toBe(0);
  
  // ──── FASE 4: VALIDAR IDEMPOTÊNCIA (reenvio não duplica) ────
  
  // Simular reenvio manual (UUID duplicado)
  await appLocal.sincronizador.sincronizar();
  
  // Contar lançamentos na nuvem novamente
  const lancamentosNuvemPosReenvio = await bancoNuvem.todas(
    "SELECT COUNT(*) as total FROM fin_lancamento"
  );
  
  expect(lancamentosNuvemPosReenvio[0].total).toBe(3); // Não duplicou!
});
```

- [ ] **Passo 2: Executar teste E2E para verificar falha**

Run: `npm test -- financeiro/e2e/fluxo-completo.test.ts`
Esperado: FAIL (ou passar se toda infra anterior foi bem)

- [ ] **Passo 3: Rodar teste para verificar sucesso**

Run: `npm test -- financeiro/e2e/fluxo-completo.test.ts`
Esperado: PASS

- [ ] **Passo 4: Commit**

```bash
git add tests/financeiro/e2e/fluxo-completo.test.ts
git commit -m "test: E2E — fluxo completo Hospedagem + Reserva + Financeiro

Valida: lançamentos automáticos, saldos corretos, operação offline, sincronização precisa, idempotência."
```

---

### Task 12: Interface Web — Básica para Financeiro (Dashboard + Telas Principais)

**Arquivos:**
- Criar: `apps/web/src/financeiro/` (componentes React)
- Criar: `apps/web/src/financeiro/dashboard.tsx`
- Criar: `apps/web/src/financeiro/lançamentos.tsx`
- Criar: `apps/web/src/financeiro/faturamento.tsx`
- Criar: `apps/web/src/financeiro/contas-receber.tsx`
- Criar: `apps/web/src/financeiro/caixa-banco.tsx`
- Modificar: `apps/web/src/app.tsx` (adicionar rotas)

**Interfaces:**
- Consome: API REST do Financeiro, tipos TypeScript (Lançamento, Faturamento, etc)
- Produz: telas React para operador gerenciar Financeiro

**Passos:**

- [ ] **Passo 1: Escrever teste de componente — Dashboard**

```typescript
test("Dashboard: exibe saldo do dia", () => {
  const mockApi = {
    obterSaldoDia: jest.fn().mockResolvedValue({
      saldo_inicial: {centavos: 1000000},
      entradas: {centavos: 300000},
      saídas: {centavos: 50000},
      saldo_final: {centavos: 1250000},
    }),
  };
  
  const {getByText} = render(<FinanceiroDashboard api={mockApi} local_id="default" />);
  
  expect(getByText("R$ 12.500,00")).toBeInTheDocument(); // saldo final
});

test("Lançamentos: listar com filtro por período", async () => {
  const mockApi = {
    listarLançamentos: jest.fn().mockResolvedValue({
      lançamentos: [
        {id: "1", origem: "hospedagem", valor: {centavos: 50000}, data: "2026-11-10"},
        {id: "2", origem: "reserva", valor: {centavos: 20000}, data: "2026-11-10"},
      ],
    }),
  };
  
  const {getByText} = render(<LançamentosTab api={mockApi} local_id="default" />);
  
  await waitFor(() => {
    expect(getByText("R$ 500,00")).toBeInTheDocument();
    expect(getByText("R$ 200,00")).toBeInTheDocument();
  });
});
```

- [ ] **Passo 2: Executar testes para verificar falha**

Run: `npm test -- financeiro/*.test.tsx`
Esperado: FAIL (componentes não existem)

- [ ] **Passo 3: Implementar componentes React (básico)**

```typescript
// financeiro/dashboard.tsx
export function FinanceiroDashboard({api, local_id}: Props) {
  const [fluxo, setFluxo] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    api.obterSaldoDia(local_id, new Date()).then(setFluxo).finally(() => setLoading(false));
  }, [local_id]);
  
  if (loading) return <div>Carregando...</div>;
  
  return (
    <div className="financeiro-dashboard">
      <div className="cards">
        <Card title="Saldo Inicial" value={formatarDinheiro(fluxo.saldo_inicial)} />
        <Card title="Entradas" value={formatarDinheiro(fluxo.entradas)} color="green" />
        <Card title="Saídas" value={formatarDinheiro(fluxo.saídas)} color="red" />
        <Card title="Saldo Final" value={formatarDinheiro(fluxo.saldo_final)} color="blue" />
      </div>
      
      <Tabs>
        <Tab name="Lançamentos">
          <LançamentosTab api={api} local_id={local_id} />
        </Tab>
        <Tab name="Faturamento">
          <FaturamentoTab api={api} local_id={local_id} />
        </Tab>
        <Tab name="Contas a Receber">
          <ContasReceberTab api={api} local_id={local_id} />
        </Tab>
        <Tab name="Caixa/Banco">
          <CaixaBancoTab api={api} local_id={local_id} />
        </Tab>
      </Tabs>
    </div>
  );
}

// financeiro/lançamentos.tsx
export function LançamentosTab({api, local_id}: Props) {
  const [lançamentos, setLançamentos] = useState([]);
  
  useEffect(() => {
    api.listarLançamentos(local_id).then(res => setLançamentos(res.lançamentos));
  }, [local_id]);
  
  return (
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Origem</th>
          <th>Tipo</th>
          <th>Forma</th>
          <th>Valor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {lançamentos.map(l => (
          <tr key={l.id}>
            <td>{new Date(l.data).toLocaleDateString()}</td>
            <td>{l.origem}</td>
            <td>{l.tipo}</td>
            <td>{l.forma_pagamento}</td>
            <td>{formatarDinheiro(l.valor)}</td>
            <td>{l.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// (similar para faturamento, contas-receber, caixa-banco)
```

- [ ] **Passo 4: Rodar testes para verificar sucesso**

Run: `npm test -- financeiro/*.test.tsx`
Esperado: PASS

- [ ] **Passo 5: Adicionar rotas em `app.tsx`**

```typescript
import {FinanceiroDashboard} from "./financeiro/dashboard";

// No router:
<Route path="/financeiro" element={<FinanceiroDashboard api={api} local_id={selectedLocal} />} />
```

- [ ] **Passo 6: Commit**

```bash
git add apps/web/src/financeiro/*.tsx tests/web/financeiro/*.test.tsx
git commit -m "feat: interface web — Dashboard e telas Financeiro

Telas básicas: Lançamentos, Faturamento, Contas a Receber, Caixa/Banco. Exibe relatórios MVP."
```

---

### Task 13: Documentação e Configuração Final

**Arquivos:**
- Criar: `docs/financeiro-README.md` (guia de uso)
- Modificar: `docs/superpowers/plans/2026-10-30-financeiro-fase1-mvp.md` (este arquivo, marcar completo)

**Passos:**

- [ ] **Passo 1: Escrever documentação de uso**

Criar `docs/financeiro-README.md` com:
- O que é o módulo Financeiro
- Como usar (criar local, lançar transações, visualizar relatórios)
- Fluxos principais (sinal, checkout, faturamento, caixa)
- Permissões e segurança
- Troubleshooting (sincronização, offline)

- [ ] **Passo 2: Commit documentação**

```bash
git add docs/financeiro-README.md
git commit -m "docs: guia de uso do módulo Financeiro

Explica fluxos, permissões, sincronização offline."
```

- [ ] **Passo 3: Merge branch para main (após review)**

```bash
git checkout main
git merge plano-b2a-retaguarda --ff-only
```

---

## Resumo de Tarefas

| # | Tarefa | Arquivos Principais | Dependências | Estimado |
|---|--------|-----------|------|----------|
| 1 | Migrações BD | `financeiro/migracao.ts` | — | 1-2 dias |
| 2 | Modelos — Local, Cadastros, Lançamento | `financeiro/modelos/*.ts` | Task 1 | 1-2 dias |
| 3 | Modelos — Faturamento, ContaReceber, Movimento | `financeiro/modelos/*.ts` | Task 2 | 1 dia |
| 4 | LocalService | `financeiro/servicos/locais.ts` | Task 2 | 2-3 dias |
| 5 | LançamentoService | `financeiro/servicos/lançamentos.ts` | Task 3 | 2-3 dias |
| 6 | CaixaBancoService | `financeiro/servicos/caixa-banco.ts` | Task 5 | 2-3 dias |
| 7 | FaturamentoService + ContasReceberService | `financeiro/servicos/faturamento.ts` | Task 6 | 3-4 dias |
| 8 | Consumidores de Eventos | `financeiro/consumidores-eventos/*.ts` | Task 7 | 2-3 dias |
| 9 | Rotas HTTP | `financeiro/rotas/*.ts` | Task 8 | 2-3 dias |
| 10 | Relatórios MVP | `financeiro/relatórios/*.ts` | Task 9 | 2-3 dias |
| 11 | Testes E2E | `tests/financeiro/e2e/*.test.ts` | Task 10 | 1-2 dias |
| 12 | Interface Web | `apps/web/src/financeiro/*.tsx` | Task 11 | 3-4 dias |
| 13 | Documentação | `docs/financeiro-README.md` | Task 12 | 1 dia |

**Total estimado:** 8-10 semanas (com 1 desenvolvedor). **Meta:** 2 meses (8 semanas) → Requer paralelização ou força (2+ devs).

---

## Critérios de Aceite para MVP

- ✅ Todos os 4 fluxos implementados (Locais, Cadastros, Contas a Receber, Caixa/Banco, Faturamento)
- ✅ Integração completa com Hospedagem (checkouts) e Reservas (sinais)
- ✅ Operação offline: criar lançamentos sem internet; sincronizar ao conectar
- ✅ 5 relatórios MVP funcionais
- ✅ Testes de unidade + E2E cobrindo fluxos principais
- ✅ Interface web básica funcional
- ✅ Documentação de uso
- ✅ Zero lançamentos perdidos ou duplicados na sincronização
