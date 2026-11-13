# Data Models - Financeiro Module

TypeScript type definitions and database schema for the Financeiro module. All models support audit trails, timestamps, and isolation by `local_id`.

---

## Local

Financial context/branch. A pousada (hotel chain) has one Local, which segregates all financial data. Each Local can designate default financial accounts for different origins (hospedagem, reserva, etc.).

### Type Definition
```typescript
type Local = {
  id: UUID;
  pousada_id: UUID;                // Links to pousada (hotel property)
  nome: string;                    // Display name (e.g., "Financeiro - Pousada Praia")
  ativo: boolean;                  // Soft delete flag
  parametros: {
    local_padrao_hospedagem: UUID; // Default account for hotel stay payments
    local_padrao_reserva: UUID;    // Default account for reservation payments
  };
};
```

### JSON Example
```json
{
  "id": "fin-local-001",
  "pousada_id": "pousada-beach-2026",
  "nome": "Financeiro - Pousada Praia",
  "ativo": true,
  "parametros": {
    "local_padrao_hospedagem": "fin-local-001",
    "local_padrao_reserva": "fin-local-001"
  }
}
```

### Database Schema
```sql
CREATE TABLE fin_local (
  id TEXT PRIMARY KEY,
  pousada_id TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  parametros TEXT,                -- JSON string
  criado_em TEXT NOT NULL
);
```

---

## Lançamento

Core transaction record. Represents all money movements: receipts, payments, transfers, and adjustments. Each Lançamento is associated with an optional account movement (Movimento) and can originate from various sources (hospedagem, bar, manual entry, etc.).

### Type Definition
```typescript
type Lançamento = {
  // Identity & Scope
  id: UUID;
  local_id: UUID;
  
  // Timing
  data: Date;                           // Transaction date (when money moved)
  hora?: string;                        // Optional time of day (ISO format)
  
  // Classification
  tipo: "recebimento"                   // Money in
         | "pagamento"                  // Money out
         | "transferencia"              // Internal transfer
         | "ajuste";                    // Manual correction
  
  origem: "hospedagem"                  // Hotel stay
          | "reserva"                   // Booking payment
          | "bar"                       // Food/beverage
          | "lavanderia"                // Laundry
          | "rh"                        // Staff/payroll
          | "manual";                   // Manual entry
  
  categoria?: string;                   // Optional user-defined category
  
  // Values
  valor: Dinheiro;                      // Amount (e.g., { centavos: 10000 } = R$ 100.00)
  
  forma_pagamento: "dinheiro"           // Cash
                   | "pix"              // PIX instant transfer
                   | "debito"           // Debit card
                   | "credito"          // Credit card
                   | "cheque"           // Check
                   | "boleto"           // Boleto slip
                   | "transferencia";   // Bank transfer
  
  descricao: string;                    // Human-readable description
  
  // Status
  status: "pendente"                    // Created, not confirmed
          | "confirmado"                // Confirmed with account movement
          | "liquidado"                 // Fully settled
          | "cancelado";                // Cancelled
  
  // Traceability
  referencia_id?: UUID;                 // ID from originating system (hospedagem_pagamento, etc.)
  referencia_tipo?: string;             // Type of reference (e.g., "hospedagem_pagamento")
  
  // Audit Trail
  auditoria: {
    criado_por: string;                 // User email or "sistema@financeiro"
    data_criacao: Date;
    dispositivo: string;                // "web", "mobile", "consumidor-eventos"
    atualizado_por?: string;            // Update user (if modified)
    data_atualizacao?: Date;
    motivo_cancelamento?: string;       // Reason if cancelled
    supervisor_autorizou?: boolean;     // True if supervisor approved cancellation
  };
};
```

### JSON Example
```json
{
  "id": "lanc-2026-11-001",
  "local_id": "fin-local-001",
  "data": "2026-11-01T14:30:00Z",
  "hora": "14:30",
  "tipo": "recebimento",
  "origem": "hospedagem",
  "categoria": "Hospedagem",
  "valor": 50000,
  "forma_pagamento": "pix",
  "descricao": "Pagamento hospedagem - Hóspede João Silva",
  "status": "confirmado",
  "referencia_id": "pag-hospedagem-2026-1001",
  "referencia_tipo": "hospedagem_pagamento",
  "auditoria": {
    "criado_por": "sistema@financeiro",
    "data_criacao": "2026-11-01T14:30:00Z",
    "dispositivo": "consumidor-eventos"
  }
}
```

### Database Schema
```sql
CREATE TABLE fin_lancamento (
  id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL,
  origem TEXT NOT NULL,
  valor INTEGER NOT NULL,
  forma_pagamento TEXT NOT NULL,
  status TEXT NOT NULL,
  referencia_id TEXT,
  referencia_tipo TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  dispositivo TEXT,
  motivo_cancelamento TEXT,
  atualizado_por TEXT,
  atualizado_em TEXT,
  FOREIGN KEY (local_id) REFERENCES fin_local(id)
);

CREATE INDEX fin_lancamento_local_data ON fin_lancamento(local_id, data);
```

---

## Faturamento

Invoice/billing record generated from hospedagem checkouts. Represents a collectible amount with a due date and collection method. A Faturamento can have multiple linked Lançamentos (partial payments).

### Type Definition
```typescript
type Faturamento = {
  // Identity & Scope
  id: UUID;
  local_id: UUID;
  cliente_id: UUID;                  // Links to fin_cliente
  
  // Origin
  referencia_id: UUID;               // ID from hospedagem checkout (valor_a_receber)
  referencia_tipo: string;           // "checkout"
  
  // Amounts
  valor_original: Dinheiro;          // Invoice amount before discount
  valor_liquido: Dinheiro;           // After discount (e.g., early payment discount)
  
  // Collection
  data_vencimento: Date;             // Due date
  forma_cobranca: "boleto"           // Boleto slip
                  | "pix"            // PIX QR code
                  | "deposito";      // Bank transfer
  
  numero_documento: string;          // Boleto number or PIX reference
  
  // Payment Status
  status: "aberto"                   // Issued, no payment
          | "parcialmente_pago"      // Some payment received
          | "pago"                   // Fully paid
          | "cancelado";             // Cancelled
  
  // Links
  lançamentos_id: UUID[];            // Array of linked payment Lançamentos
};
```

### JSON Example
```json
{
  "id": "fat-2026-11-001",
  "local_id": "fin-local-001",
  "cliente_id": "cliente-joao-silva",
  "referencia_id": "var-checkout-2026-101",
  "referencia_tipo": "checkout",
  "valor_original": 50000,
  "valor_liquido": 49500,
  "data_vencimento": "2026-12-01",
  "forma_cobranca": "boleto",
  "numero_documento": "123456789.01 12345678901234 567890123456 7",
  "status": "parcialmente_pago",
  "lançamentos_id": ["lanc-2026-11-025"]
}
```

### Database Schema
```sql
CREATE TABLE fin_faturamento (
  id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  referencia_id TEXT NOT NULL,
  valor_original INTEGER NOT NULL,
  valor_liquido INTEGER NOT NULL,
  data_vencimento TEXT NOT NULL,
  forma_cobranca TEXT NOT NULL,
  numero_documento TEXT,
  status TEXT NOT NULL,
  lançamentos_id TEXT,                -- JSON array
  criado_em TEXT NOT NULL,
  FOREIGN KEY (local_id) REFERENCES fin_local(id),
  FOREIGN KEY (cliente_id) REFERENCES fin_cliente(id)
);
```

---

## ContaReceber

Receivable record: tracks amounts owed by a customer. Created from a Faturamento and linked to payment Lançamentos as they arrive. Unlike Faturamento (which is invoice-centric), ContaReceber is payment-centric.

### Type Definition
```typescript
type ContaReceber = {
  // Identity & Scope
  id: UUID;
  local_id: UUID;
  cliente_id: UUID;                  // Links to fin_cliente
  
  // Document
  numero_documento: string;          // Invoice/receipt number
  tipo_documento?: string;           // "fatura", "recibo", etc.
  
  // Amounts
  valor_original: Dinheiro;          // Original amount owed
  valor_recebido: Dinheiro;          // Sum of all received payments
  valor_pendente?: Dinheiro;         // Calculated: original - received (not persisted)
  
  // Dates
  data_emissao: Date;                // When issued
  data_vencimento: Date;             // Due date
  data_recebimento?: Date;           // When fully received
  
  // Payment Details
  forma_pagamento: "boleto"          // Boleto
                   | "pix"           // PIX
                   | "deposito"      // Bank transfer
                   | "dinheiro"      // Cash
                   | "transferencia"; // Internal transfer
  
  conta_destino_id?: UUID;           // Bank account receiving payment
  
  // Status
  status: "pendente"                 // Issued, not received
          | "parcialmente_recebido"  // Partial payment
          | "recebido"               // Fully received
          | "cancelado";             // Cancelled
  
  // Links
  lançamentos_id: UUID[];            // Linked payment Lançamentos
};
```

### JSON Example
```json
{
  "id": "cr-2026-11-001",
  "local_id": "fin-local-001",
  "cliente_id": "cliente-joao-silva",
  "numero_documento": "123456789.01 12345678901234 567890123456 7",
  "tipo_documento": "fatura",
  "valor_original": 50000,
  "valor_recebido": 30000,
  "valor_pendente": 20000,
  "data_emissao": "2026-11-01",
  "data_vencimento": "2026-12-01",
  "forma_pagamento": "boleto",
  "conta_destino_id": "conta-caixa-001",
  "status": "parcialmente_recebido",
  "lançamentos_id": ["lanc-2026-11-025", "lanc-2026-11-050"]
}
```

### Database Schema
```sql
CREATE TABLE fin_conta_receber (
  id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  numero_documento TEXT NOT NULL,
  valor_original INTEGER NOT NULL,
  valor_recebido INTEGER NOT NULL DEFAULT 0,
  data_vencimento TEXT NOT NULL,
  forma_pagamento TEXT NOT NULL,
  status TEXT NOT NULL,
  conta_destino_id TEXT,
  lançamentos_id TEXT,                -- JSON array
  criado_em TEXT NOT NULL,
  FOREIGN KEY (local_id) REFERENCES fin_local(id),
  FOREIGN KEY (cliente_id) REFERENCES fin_cliente(id)
);
```

---

## Movimento

Account ledger entry. Each Movimento represents a debit or credit operation on a bank/cash account. Created whenever a Lançamento is applied to an account.

### Type Definition
```typescript
type Movimento = {
  // Identity & Scope
  id: UUID;
  local_id: UUID;
  
  // References
  conta_id: UUID;                    // Bank/cash account
  lancamento_id: UUID;               // Linked transaction
  
  // Operation
  tipo: "credito"                    // Money in
        | "debito"                   // Money out
        | "transferencia_out"        // Transfer from this account
        | "transferencia_in";        // Transfer to this account
  
  // Amounts
  valor: Dinheiro;                   // Transaction amount
  saldo_anterior: Dinheiro;          // Balance before transaction
  saldo_posterior: Dinheiro;         // Balance after (calculated: anterior ± valor)
  
  // Dates
  data: Date;                        // Transaction date
  criado_em: Date;                   // Record creation timestamp
};

type Saldo = {
  // Identity & Scope
  id: UUID;
  conta_id: UUID;
  
  // Data
  data: Date;                        // Balance date (usually EOD)
  saldo: Dinheiro;                   // Balance amount (calculated from Movimentos)
  criado_em?: Date;                  // Record creation
};
```

### JSON Example - Movimento
```json
{
  "id": "mov-2026-11-001",
  "local_id": "fin-local-001",
  "conta_id": "conta-caixa-001",
  "lancamento_id": "lanc-2026-11-001",
  "tipo": "credito",
  "valor": 50000,
  "saldo_anterior": 100000,
  "saldo_posterior": 150000,
  "data": "2026-11-01T14:30:00Z",
  "criado_em": "2026-11-01T14:30:00Z"
}
```

### JSON Example - Saldo
```json
{
  "id": "saldo-2026-11-01",
  "conta_id": "conta-caixa-001",
  "data": "2026-11-01",
  "saldo": 150000,
  "criado_em": "2026-11-02T01:00:00Z"
}
```

### Database Schema
```sql
CREATE TABLE fin_movimento (
  id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  conta_id TEXT NOT NULL,
  lancamento_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  valor INTEGER NOT NULL,
  saldo_anterior INTEGER NOT NULL,
  saldo_posterior INTEGER NOT NULL,
  data TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (local_id) REFERENCES fin_local(id),
  FOREIGN KEY (conta_id) REFERENCES fin_conta_bancaria(id),
  FOREIGN KEY (lancamento_id) REFERENCES fin_lancamento(id)
);

CREATE INDEX fin_movimento_conta_data ON fin_movimento(conta_id, data);

CREATE TABLE fin_saldo (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL,
  data TEXT NOT NULL,
  saldo INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (conta_id) REFERENCES fin_conta_bancaria(id)
);

CREATE INDEX fin_saldo_conta_data ON fin_saldo(conta_id, data);
```

---

## Related Models (Reference)

### Cliente (fin_cliente)
Customer record for invoicing and receivables.

```typescript
type Cliente = {
  id: UUID;
  local_id: UUID;
  nome: string;
  cpf_cnpj?: string;
  tipo: "pessoa_fisica" | "pessoa_juridica";
  contato?: string;
};
```

### ContaBancaria (fin_conta_bancaria)
Bank or cash account (e.g., "Caixa", "Banco do Brasil - Corrente", etc.).

```typescript
type ContaBancaria = {
  id: UUID;
  local_id: UUID;
  nome: string;
  banco: string;
  agencia: string;
  numero: string;
  tipo: string;
  saldo_inicial: Dinheiro;
};
```

---

## Data Types

### Dinheiro (Money)
Money values in the system are represented as centavos (1/100 of Real).

```typescript
type Dinheiro = {
  centavos: number;  // e.g., 10000 = R$ 100.00
};
```

In API responses, Dinheiro is serialized as a plain number:
```json
{ "valor": 10000 }  // Means R$ 100.00
```

### UUID
Unique identifier (36 characters, hyphenated UUID v4).

---

## Constraints & Rules

1. **Local Scoping**: All operations must include `local_id` and are automatically scoped to that local.
2. **Positive Values**: `valor` in Lançamento and transfers must be positive; refunds use `tipo: "ajuste"`.
3. **Audit Trail**: Every Lançamento captures `criado_por`, `data_criacao`, and `dispositivo`; cancellations add `motivo_cancelamento` and `supervisor_autorizou`.
4. **Idempotency**: Duplicate `referencia_id` + `referencia_tipo` checks prevent creating the same transaction twice (used by event consumers).
5. **Derived Fields**: `valor_pendente` on ContaReceber and `saldo_posterior` on Movimento are calculated, not stored.

## Título (parcelamento)

```typescript
Titulo {
  id: UUID
  local_id: UUID
  tipo: "pagar" | "receber"
  documento: string
  valor_total: number            // centavos; soma exata das parcelas
  num_parcelas: number           // 2..60
  intervalo: "30_dias" | "mensal" | "livre"
  status: "ativo" | "cancelado"
}
```

Tabela `fin_titulo`. Cada parcela é um `fin_lancamento` (a pagar) ou um `fin_conta_receber` (manual) com `titulo_id`, `parcela_num` e `parcela_total`. A parcela de saldo de um pagamento parcial herda os três campos e `parcela_de`.
