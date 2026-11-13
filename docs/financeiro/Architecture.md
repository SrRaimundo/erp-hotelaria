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
│   ├── faturamento.ts               # GET /faturamentos, /faturamentos/extrato, POST /faturamentos/fechar-grupo
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

The Financeiro module is driven by events from the Hospedagem (hotel bookings) system. This creates a clean separation of concerns. Delivery to the Financeiro is durable (outbox + persisted cursor, see below). Synchronizing with the cloud is NOT implemented here: it belongs to Plan C.

### Event Flow

```
HOSPEDAGEM (same transaction as the hotel operation)
   └─► writes the event to the `outbox` table (seq, tipo, payload)
          │ commit
          ▼
   event bus (in memory)  ── only a "wake up" signal ──►  processarPendentes()
                                                              │
   boot (before listen) and the scheduler (every 60 s) ──────►│
                                                              ▼
                              reads `outbox` rows with seq > fin_cursor.ultimo_seq
                              for the hospedagem.* types, in seq order
                                                              │
        per event, ONE transaction: handler effect + cursor advance
                                                              │
   PagamentoRegistrado ─► Lançamento (+ Movimento for cash/PIX, + cartão movement for debit/credit)
   PagamentoEstornado  ─► reverses the Lançamento and its effect (or raises an alert)
   ValorAReceberCriado ─► Faturamento (open; Conta a Receber only when the invoice is closed)
```

Properties (all covered by tests in `apps/server/test/financeiro/fila.test.ts` and `reversao.test.ts`):

- **Catch-up after a crash**: events committed before a crash are consumed at the next start, exactly once.
- **Order**: strictly by `seq`. A failing event blocks the ones after it (a reversal never overtakes its payment).
- **Failure**: the transaction rolls back, the cursor does not move, the event is retried at the next cycle (bus signal or 60 s scheduler).
  After 3 failures an `alertas` entry (`financeiro_evento_falhou`) is raised and resolved when the event finally succeeds.
  A permanently failing event keeps blocking the queue until its cause is fixed: this is deliberate and visible through the alert.
- **The hotel operation never fails because of the Financeiro**: consumption runs after the hospedagem commit.
- **Initial position**: migration 0740 starts the cursor at the highest existing `outbox.seq`. History from before the Financeiro was installed is **not** reprocessed (no opening balances are known for it). A new database starts at 0.
- Handlers are also idempotent by business key (`referencia_id`, unique partial index), so a replay is harmless.

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
   - **Débito/Crédito**: Create a `fin_cartao_movimento` (a receber da operadora). With exactly one active condition of the type in the Local (Cadastros > Cobrança) it takes that condition's prazo (D+N) and taxa as a snapshot; with none (or several) it is flagged `revisar` with no taxa/prazo invented, and cannot be baixado until the condition is chosen. No Movimento until the baixa (net of the fee).
   - **Other forms**: Ignore (only direct payments recorded)

### Processing Flow: ValorAReceberCriado

1. **Event Received**: `hospedagem.ValorAReceberCriado` from hospedagem checkout
2. **Duplicate Check**: Query `fin_faturamento` for existing `referencia_id`
   - If found: return (idempotent)
   - If not found: proceed to step 3
3. **Resolve Local & Upsert Cliente**: Same as PagamentoRegistrado
4. **Create Faturamento**:
   - `referencia_id` from checkout (`valor_a_receber.id`)
   - Status: `"aberto"`, no document number yet
5. **Stop here**: the checkout stays an open closing in the Faturamento screen. The operator closes the invoice there
   (one or several closings of the same client); closing generates the document number and creates ONE ContaReceber for the sum.

### Processing Flow: PagamentoEstornado

1. Find the Lançamento by `referencia_id` = `pagamentoId` (`referencia_tipo: "hospedagem_pagamento"`). Already cancelled: do nothing (once only).
2. Card movement already **baixado**: change nothing, raise alert `financeiro_estorno_conciliado` for a manual decision (reverse the baixa in Caixa e Banco).
3. Otherwise cancel the Lançamento through the single reversal rule: opposite Movimento (saldo restored) and card movement cancelled.
4. Faturado payment: the open Faturamento is cancelled; if the invoice is already closed (or the match is ambiguous), alert instead.

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

The `financeiro.gerenciar` permission controls who can:
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
        ├─► Check "financeiro.gerenciar" ✓
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

### Outbox and idempotency (what exists)

The module reads the existing `outbox` through a persisted cursor (`fin_cursor`), as described in "Event Flow".
Exactly-once *effect* comes from the cursor advancing in the same transaction as the handler, plus idempotent handlers:

```typescript
const dup = await tx.db
  .selectFrom("fin_lancamento")
  .select("id")
  .where("referencia_id", "=", p.pagamentoId)
  .where("referencia_tipo", "=", "hospedagem_pagamento")
  .executeTakeFirst();
if (dup) return; // already processed
```

Money actions started from the screen (create conta a pagar, receive, transfer, close invoice, create cartão movement, create local/conta/fornecedor)
accept an optional `chave` in the body. The same `chave` sent twice (double click, retry) runs once and returns the first response
(`fin_idempotencia`). A failed attempt does not consume the key.

### Poison events and the Fila screen

A deterministic handler failure blocks the queue (order is preserved). The "Fila do Financeiro" screen (`config.gerenciar`) lists the blocked event and error,
with **Tentar de novo** and **Ignorar evento** (motivo + supervisor, audited, persisted in `fin_evento_ignorado`, alert `financeiro_evento_ignorado` with the amount).
Already-applied or already-reversed states are a no-op with an alert (`financeiro_estorno_duplicado`), never a failure.
Reading the queue never throws: a DB error there is logged and retried, and does not stop the server from starting.

### Source of truth

Entries that originate in hospedagem (payments, faturado) are reversed only in hospedagem; the Financeiro refuses to reverse them. Everything created in the Financeiro
(contas a pagar, manual contas a receber, receipts, card movements entered by hand) is reversed here with one rule (`servicos/reversao.ts`).

### Not implemented: cloud synchronization

Sending Financeiro data to the cloud ("sincronizar ao conectar") is **Plan C** and is out of scope here:

- Nothing in the repository reads `outbox.enviado_em` (no synchronizer exists yet).
- The Financeiro does not publish its own events (Lançamentos, Movimentos) to the `outbox`.
- The system works fully on the local server without internet; the cloud copy is a later phase.

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

Prevented by explicit duplicate checks before writes, backed by unique partial indexes (`fin_lancamento` by hospedagem payment, `fin_faturamento` by checkout) as a last defense.

### Missing References

Validation before foreign key operations (e.g., conta_id must exist).

### Retryable Events

Events that fail are retried automatically (cursor not advanced, retried every cycle). After 3 failures an alert is raised. Nothing is lost on a crash: the event stays in the `outbox` and is consumed at the next start.

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
