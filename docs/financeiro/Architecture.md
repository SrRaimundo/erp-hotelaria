# Architecture - Financeiro Module

System design, event-driven integration, auditability, offline-first approach, and isolation patterns.

---

## Module Structure

```
apps/server/src/financeiro/
├── migracao.ts                      # Database schema (Kysely migrations)
├── modelos/                         # TypeScript type definitions
│   ├── local.ts                     # Financial context/branch
│   ├── lançamento.ts                # Core transaction record
│   ├── faturamento.ts               # Invoice/billing
│   ├── conta-receber.ts             # Receivable tracking
│   ├── movimento.ts                 # Account ledger
│   └── cadastros.ts                 # Cliente, ContaBancaria, Fornecedor
├── servicos/                        # Business logic layer
│   ├── locais.ts                    # Local management
│   ├── lançamentos.ts               # Transaction creation & cancellation
│   ├── faturamento.ts               # Invoice generation & collection
│   ├── contas-receber.ts            # Receivable payment confirmation
│   └── caixa-banco.ts               # Balance queries & transfers
├── consumidores-eventos/            # Event consumer handlers
│   └── hospedagem-pagamento.ts      # Listens to hospedagem events
│       ├── processarPagamentoRegistrado()     # Hospedagem payment → Lançamento
│       ├── processarValorAReceberCriado()     # Checkout → Faturamento
│       └── registrarConsumidoresHospedagem()  # Event subscription setup
├── rotas/                           # HTTP API endpoints
│   ├── index.ts                     # Router aggregator
│   ├── comum.ts                     # Shared validation & auth
│   ├── lançamentos.ts               # GET /lancamentos, DELETE /lancamentos/:id
│   ├── faturamento.ts               # POST /faturamento/gerar-cobranca
│   ├── contas-receber.ts            # PUT /contas-receber/:id/confirmar-pagamento
│   └── caixa-banco.ts               # GET/POST caixa-banco/saldo & /transferencia
└── relatórios/                      # Reporting queries
    ├── rotas.ts                     # Reporting API endpoints
    ├── comum.ts                     # Report utilities
    ├── fluxo-caixa.ts               # Cash flow report
    ├── consolidado.ts               # Consolidated report
    ├── contas-receber.ts            # Receivable aging report
    ├── movimento-conta.ts           # Account movement detail
    └── cartao.ts                    # Credit card settlement report
```

---

## Event-Driven Integration

The Financeiro module is driven by events from the Hospedagem (hotel bookings) system. This creates a clean separation of concerns and supports offline-first synchronization.

### Event Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        HOSPEDAGEM (Bookings)                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ├─► hospedagem.PagamentoRegistrado
                             │   └─► Contém: pagamentoId, contaId,
                             │       reservaId?, formaCodigo, valor
                             │
                             └─► hospedagem.ValorAReceberCriado
                                 └─► Contém: valorAReceberId,
                                     responsavel, valor

                             │
                ┌────────────▼────────────────────────────────────┐
                │     BARRAMENTO (Event Bus / Message Queue)      │
                └────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────────────┐
              │                                     │
              ▼                                     ▼
    ┌─────────────────────────────┐    ┌──────────────────────────┐
    │  PagamentoRegistrado        │    │ ValorAReceberCriado      │
    │  Consumer                   │    │ Consumer                 │
    └─────────────────────────────┘    └──────────────────────────┘
              │                                     │
              │ ◄── Duplicate check by ID          │ ◄── Duplicate check
              │     (Outbox pattern)               │     (Outbox pattern)
              │                                     │
              ▼                                     ▼
    ┌─────────────────────────────┐    ┌──────────────────────────┐
    │ Lançamento + Movimento      │    │ Faturamento +            │
    │ (if cash/PIX)               │    │ Cobrança + ContaReceber  │
    └─────────────────────────────┘    └──────────────────────────┘
              │                                     │
              └──────────────┬──────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   FINANCEIRO    │
                    │    Database     │
                    └─────────────────┘
```

### Processing Flow: PagamentoRegistrado

1. **Event Received**: `hospedagem.PagamentoRegistrado` from the barramento
2. **Duplicate Check**: Query `fin_lancamento` for existing `referencia_id` + `referencia_tipo`
   - If found: return (idempotent)
   - If not found: proceed to step 3
3. **Resolve Local**: Fetch default financial Local from parameters
4. **Upsert Cliente**: Create or reuse fin_cliente (by CPF/CNPJ or name)
5. **Create Lançamento**:
   - `tipo: "recebimento"`, `origem: "hospedagem"`
   - `forma_pagamento` from event (dinheiro, pix, debito, credito)
   - Status: `"pendente"` → `"confirmado"` when Movimento created
6. **Route by Payment Form**:
   - **Dinheiro/PIX**: Create `Movimento` immediately (credito to "Caixa" account)
   - **Débito/Crédito**: Log and wait for card settlement consumer (not implemented yet)
   - **Other forms**: Ignore (only direct payments recorded)

### Processing Flow: ValorAReceberCriado

1. **Event Received**: `hospedagem.ValorAReceberCriado` from hospedagem checkout
2. **Duplicate Check**: Query `fin_faturamento` for existing `referencia_id`
   - If found: return (idempotent)
   - If not found: proceed to step 3
3. **Resolve Local & Upsert Cliente**: Same as PagamentoRegistrado
4. **Create Faturamento**:
   - `referencia_id` from checkout (`valor_a_receber.id`)
   - `forma_cobranca: "boleto"` (default)
   - `data_vencimento: data_emissao + 30 dias`
   - Status: `"aberto"`
5. **Generate Billing**:
   - Call FaturamentoService.gerarCobranca() to create boleto number
   - Update Faturamento with `numero_documento`
6. **Create ContaReceber**:
   - Links to Faturamento and Cliente
   - Status: `"pendente"`
   - Forms: can be "boleto", "pix", "deposito", etc.

---

## Data Isolation & Scoping

### Local-Based Isolation

Every financial entity is scoped to a **Local** (financial context). In the ALICE system, there is one Local per pousada.

**Why?**
- Multi-property support (future)
- Clear audit trails per location
- Regulatory compliance (separate financials per entity)

**Implementation:**
- Every table has `local_id` column
- Every query filters by `local_id`
- Database indices: `(local_id, other_columns)` for performance
- Example: `CREATE INDEX fin_lancamento_local_data ON fin_lancamento(local_id, data)`

### User-Based Authorization

The `caixa.operar` permission controls who can:
- View transactions
- Create transactions
- Confirm payments
- Transfer between accounts
- Cancel transactions (requires supervisor auth)

**Auth Flow:**
```
Request with JWT token
        │
        ├─► Extract user.id, user.permissoes
        │
        ├─► Check "caixa.operar" ✓
        │
        └─► User can access their Local's data
```

### Supervisor Authorization

Sensitive actions (transaction cancellation) require supervisor verification:

```
DELETE /api/financeiro/lancamentos/:id
  ├─► Body: { motivo, supervisor: { login, senha } }
  ├─► Call autorizarSupervisor(ctx, supervisor, motivo)
  │   └─► Verify supervisor credentials against permissoes.supervisor
  ├─► If valid: Create Lançamento with status "cancelado"
  │   └─► Audit: motivo_cancelamento, supervisor_autorizou: true
  └─► If invalid: 403 Forbidden
```

---

## Offline-First & Event Sourcing

### Outbox Pattern (Idempotency)

The system uses an **Outbox pattern** to ensure exactly-once processing and offline resilience:

1. **Transaction Isolation**: Each consumer operation is wrapped in `emTransacao(ctx, async (tx) => { ... })`
2. **Duplicate Detection**: Before processing, check if `referencia_id` already exists
3. **Atomic Writes**: Write Lançamento and Movimento in same transaction
4. **Idempotency by UUID**: Every event has a unique `referencia_id` from the source system

**Example (PagamentoRegistrado):**
```typescript
const dup = await tx.db
  .selectFrom("fin_lancamento")
  .select("id")
  .where("referencia_id", "=", p.pagamentoId)       // ← UUID from event
  .where("referencia_tipo", "=", "hospedagem_pagamento")
  .executeTakeFirst();

if (dup) return;  // Already processed; safe to skip
```

**Benefits:**
- Events can be replayed without creating duplicates
- Supports offline scenarios: events queue locally, sync when online
- Guarantees data consistency even with network retries

### No Immediate Deletions

The system uses **soft deletes** (`ativo: 0` for Local) and **status fields** for cancellations:
- `status: "cancelado"` for Lançamento, Faturamento, ContaReceber
- Never true DELETE; always UPDATE status
- Audit trail preserved for compliance

---

## Transaction Semantics

### ACID Guarantees

All operations within services are wrapped in `emTransacao`:

```typescript
await emTransacao(ctx, async (tx: Contexto) => {
  // All database operations here
  // If any fails: entire transaction rolls back
  // On success: atomically committed
});
```

### State Transitions

**Lançamento:**
```
┌────────────┐
│  pendente  │ ◄─────────────────┐
└────────┬───┘                   │
         │ Link to account       │
         ▼                       │
┌────────────────┐               │
│   confirmado   │ ◄─ Balance OK  │
└────────┬───────┘               │
         │ (automatic)           │
         ▼                       │
┌────────────────┐   Cancel      │
│   liquidado    │ ─────────────→ cancelado
└────────────────┘               │
                                 │
                   (supervisor auth + motivo)
```

**Faturamento:**
```
┌────────┐
│ aberto │ ◄──────────────────┐
└────┬───┘                    │
     │ Payment received       │
     ▼                        │
┌──────────────────────┐      │
│ parcialmente_pago    │      │
└────────┬─────────────┘      │
         │ All paid           │
         ▼                    │
┌──────────────────────┐      │
│       pago           │      │
└──────────────────────┘      │
         ▲                    │
         └──── (if cancelado) ─ cancelado
```

**ContaReceber:**
```
Similar to Faturamento; tracks receivables per customer/invoice.
```

---

## Services & Dependencies

### LançamentoService
Handles transaction creation and cancellation. Interacts with:
- `Contexto.db` (database)
- `Contexto.relogio` (clock for timestamps)

**Key Methods:**
- `criar(opts: {...})`: Create new Lançamento
- `listar(local_id, opts)`: Query by date range
- `cancelar(id, motivo, supervisorId, usuario)`: Cancel with audit

### FaturamentoService
Manages invoices and billing generation. Calls external services if needed (boleto generation).

**Key Methods:**
- `criarParaCheckout(valorAReceberId, cliente_id, ...)`: Create from checkout
- `gerarCobranca(faturamento_id, forma, usuario)`: Generate billing document
- `registrarPagamento(faturamento_id, valor, ...)`: Record payment

### ContasReceberService
Tracks receivables and payment confirmation.

**Key Methods:**
- `criarRecebivel(...)`: Create from invoice
- `confirmarPagamento(id, valor, conta_bancaria_id, usuario)`: Confirm received

### CaixaBancoService
Manages account balance queries and transfers.

**Key Methods:**
- `obterSaldo(conta_id, ate)`: Get balance on a date
- `criarMovimento(lancamento, conta_id, usuario)`: Record account entry
- `transferir(origem_id, destino_id, valor, usuario)`: Transfer between accounts

### LocalService
Local (branch/context) management.

**Key Methods:**
- `obter(id)`: Fetch Local and parameters
- `listar()`: All locals for this pousada

---

## Auditability & Compliance

### Audit Fields

Every Lançamento captures:
- **criado_por**: User ID or "sistema@financeiro" (for event consumers)
- **data_criacao**: ISO timestamp
- **dispositivo**: "web", "mobile", or "consumidor-eventos"
- **atualizado_por**: Who made the last change
- **data_atualizacao**: When changed
- **motivo_cancelamento**: Why cancelled (if applicable)
- **supervisor_autorizou**: Boolean flag if supervisor signed off

### Immutability & Append-Only Logs

Once a Lançamento is created, only its status can change. No field updates. This supports:
- Regulatory audits (financial transaction log)
- Dispute resolution (clear record of what happened when)
- Compliance (LGPD, fiscal regulations in Brazil)

### Example Audit Trail:
```
Lançamento ID: lanc-2026-11-001
├─ Created: 2026-11-01T10:30:00Z by sistema@financeiro (device: consumidor-eventos)
│  └─ valor: 50000, forma: pix, origem: hospedagem
│
└─ Cancelled: 2026-11-01T11:00:00Z by supervisor@hotel.com (device: web)
   └─ motivo: "Estorno de pagamento duplicado"
   └─ supervisor_autorizou: true
```

---

## Performance Considerations

### Indices

Critical indices for typical queries:

```sql
-- Transaction history by local and date
CREATE INDEX fin_lancamento_local_data 
  ON fin_lancamento(local_id, data);

-- Account movement history
CREATE INDEX fin_movimento_conta_data 
  ON fin_movimento(conta_id, data);

-- Balance history
CREATE INDEX fin_saldo_conta_data 
  ON fin_saldo(conta_id, data);
```

### Query Patterns

1. **List transactions by date range**: `O(log n)` via index
2. **Get account balance on date**: Scan Movimento or Saldo table, typically < 100ms
3. **Find duplicate by referencia_id**: `O(log n)` direct lookup

### Batch Operations

For high-volume scenarios (e.g., reconciliation import):
- Use transaction batches: `emTransacao(ctx, async (tx) => { ... multiple inserts ... })`
- Avoid N+1 queries: pre-fetch related entities

---

## Event Consumer Registration

The module registers its event consumers in the main application startup:

```typescript
// In main.ts or app initialization
import { registrarConsumidoresHospedagem } from "./financeiro/consumidores-eventos/hospedagem-pagamento.js";

registrarConsumidoresHospedagem(ctx);  // Must be called before server starts
```

This subscribes to:
- `hospedagem.PagamentoRegistrado`
- `hospedagem.ValorAReceberCriado`

---

## Error Handling & Recovery

### Transactional Rollback

If any step fails during event processing:
```typescript
await emTransacao(ctx, async (tx) => {
  // Step 1: validate
  const local_id = await resolverLocal(tx);
  if (!local_id) throw new Error("...");  // ← Entire transaction rolls back
  
  // Step 2: create records
  // If this fails, step 1 is undone
});
```

### Duplicate Key Violations

Prevented by explicit duplicate checks before writes. No constraint-based errors.

### Missing References

Validation before foreign key operations (e.g., conta_id must exist).

### Retryable Events

Events failed processing are NOT automatically retried (responsibility of message broker). Manual intervention may be needed if consumer crashes.

---

## Testing Recommendations

See [Setup.md](./Setup.md) for testing commands.

### Unit Tests

- Service logic: LançamentoService, FaturamentoService
- Validation: Date parsing, UUID formats, monetary values

### Integration Tests

- Event processing: Simulate PagamentoRegistrado events
- Transaction atomicity: Verify rollback on failure
- Duplicate detection: Replay same event, verify idempotency

### End-to-End Tests

- Full flow: Hospedagem payment → Lançamento → Movimento → Account balance
- API endpoints: Auth, validation, response formats

---

## Related Documentation

- [API.md](./API.md) — HTTP endpoint reference
- [Models.md](./Models.md) — Data types and schemas
- [Setup.md](./Setup.md) — Developer guide and running the module
