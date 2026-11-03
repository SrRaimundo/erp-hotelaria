# API Reference - Financeiro Module

HTTP API endpoints for the Financeiro (Financial) module. All routes are prefixed with `/api/financeiro` and require the `caixa.operar` permission.

## Authentication & Authorization

All endpoints require:
- **Authentication**: Valid JWT token in `Authorization: Bearer <token>` header (enforced by `/api` hook)
- **Permission**: `caixa.operar` (checked at route level)
- **Scope**: Data is automatically scoped to the user's local (pousada)

## Routes

### Lançamentos (Transactions)

#### GET /api/financeiro/lancamentos
List all transactions for a local within a date range.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `local_id` | UUID | Yes | Financial local identifier |
| `data_inicio` | string (YYYY-MM-DD) | No | Start date (inclusive, UTC 00:00:00) |
| `data_fim` | string (YYYY-MM-DD) | No | End date (inclusive, UTC 23:59:59) |

**Success Response (200):**
```json
[
  {
    "id": "uuid",
    "local_id": "uuid",
    "data": "2026-11-01T10:30:00Z",
    "tipo": "recebimento",
    "origem": "hospedagem",
    "valor": 10000,
    "forma_pagamento": "pix",
    "descricao": "Pagamento hospedagem",
    "status": "confirmado",
    "referencia_id": "uuid",
    "referencia_tipo": "hospedagem_pagamento",
    "auditoria": {
      "criado_por": "user@email.com",
      "data_criacao": "2026-11-01T10:30:00Z",
      "dispositivo": "web"
    }
  }
]
```

**Error Responses:**
| Code | Description |
|------|-------------|
| 401 | Missing or invalid JWT token |
| 403 | User lacks `caixa.operar` permission |
| 422 | Invalid query parameters (malformed UUID, invalid date format) |

---

#### DELETE /api/financeiro/lancamentos/:id
Cancel a transaction (sensitive action requiring supervisor authorization).

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | UUID | Yes | Transaction ID to cancel |

**Request Body:**
```json
{
  "motivo": "Estorno de pagamento duplicado",
  "supervisor": {
    "login": "supervisor_email@hotel.com",
    "senha": "supervisor_password"
  }
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `motivo` | string | Yes | Reason for cancellation (audit trail) |
| `supervisor` | object | No | Supervisor credentials; if omitted, performs local supervisor check |
| `supervisor.login` | string | No | Supervisor email/login |
| `supervisor.senha` | string | No | Supervisor password |

**Success Response (200):**
```json
{
  "id": "uuid",
  "local_id": "uuid",
  "data": "2026-11-01T10:30:00Z",
  "tipo": "recebimento",
  "origem": "hospedagem",
  "valor": 10000,
  "forma_pagamento": "pix",
  "status": "cancelado",
  "auditoria": {
    "criado_por": "user@email.com",
    "data_criacao": "2026-11-01T10:30:00Z",
    "dispositivo": "web",
    "atualizado_por": "supervisor@hotel.com",
    "data_atualizacao": "2026-11-01T11:00:00Z",
    "motivo_cancelamento": "Estorno de pagamento duplicado",
    "supervisor_autorizou": true
  }
}
```

**Error Responses:**
| Code | Description |
|------|-------------|
| 401 | Missing or invalid JWT token |
| 403 | User lacks `caixa.operar` permission; or supervisor authorization failed |
| 422 | Invalid UUID or missing required body fields |
| 500 | Transaction not found or already cancelled |

---

### Faturamento (Invoicing)

#### POST /api/financeiro/faturamento/gerar-cobranca
Generate a billing collection request (boleto, PIX, or bank transfer) for an invoice.

**Request Body:**
```json
{
  "faturamento_id": "uuid",
  "forma": "boleto"
}
```

**Parameters:**
| Field | Type | Required | Allowed Values | Description |
|-------|------|----------|-----------------|-------------|
| `faturamento_id` | UUID | Yes | - | Invoice (Faturamento) ID |
| `forma` | string | Yes | `boleto`, `pix`, `deposito` | Collection method |

**Success Response (201):**
```json
{
  "id": "uuid",
  "local_id": "uuid",
  "cliente_id": "uuid",
  "referencia_id": "uuid",
  "referencia_tipo": "checkout",
  "valor_original": 50000,
  "valor_liquido": 49500,
  "data_vencimento": "2026-12-01",
  "forma_cobranca": "boleto",
  "numero_documento": "123456789.01 12345678901234 567890123456 7",
  "status": "aberto",
  "lançamentos_id": []
}
```

**Error Responses:**
| Code | Description |
|------|-------------|
| 401 | Missing or invalid JWT token |
| 403 | User lacks `caixa.operar` permission |
| 422 | Invalid UUID; invalid collection method; or invoice not found |
| 500 | Error generating billing document (e.g., bank integration failure) |

---

### Contas a Receber (Receivables)

#### PUT /api/financeiro/contas-receber/:id/confirmar-pagamento
Confirm payment receipt for a receivable, linking it to a transaction (Lançamento).

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | UUID | Yes | Receivable (ContaReceber) ID |

**Request Body:**
```json
{
  "valor": 50000,
  "conta_bancaria_id": "uuid"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `valor` | integer (centavos) | Yes | Amount received (must be positive) |
| `conta_bancaria_id` | UUID | Yes | Bank account ID receiving the payment |

**Success Response (200):**
```json
{
  "id": "uuid",
  "local_id": "uuid",
  "cliente_id": "uuid",
  "numero_documento": "123456789.01 12345678901234 567890123456 7",
  "valor_original": 50000,
  "valor_recebido": 50000,
  "valor_pendente": 0,
  "data_emissao": "2026-11-01",
  "data_vencimento": "2026-12-01",
  "data_recebimento": "2026-11-15",
  "forma_pagamento": "boleto",
  "status": "recebido",
  "lançamentos_id": ["uuid"]
}
```

**Error Responses:**
| Code | Description |
|------|-------------|
| 401 | Missing or invalid JWT token |
| 403 | User lacks `caixa.operar` permission |
| 422 | Invalid UUID; invalid valor (must be positive); or receivable not found |
| 500 | Bank account not found; or error creating linked transaction |

---

### Caixa & Banco (Cash & Bank Accounts)

#### GET /api/financeiro/caixa-banco/saldo
Get the balance of a bank/cash account on a specific date.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `conta_id` | UUID | Yes | Bank/cash account ID |
| `data` | string (YYYY-MM-DD) | No | Query date (defaults to current time) |

**Success Response (200):**
```json
{
  "conta_id": "uuid",
  "data": "2026-11-01T23:59:59.999Z",
  "saldo": 100000
}
```

**Error Responses:**
| Code | Description |
|------|-------------|
| 401 | Missing or invalid JWT token |
| 403 | User lacks `caixa.operar` permission |
| 422 | Invalid UUID; or invalid date format |
| 500 | Account not found |

---

#### POST /api/financeiro/caixa-banco/transferencia
Transfer money between two bank/cash accounts (creates two linked movements).

**Request Body:**
```json
{
  "origem": "uuid",
  "destino": "uuid",
  "valor": 50000
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `origem` | UUID | Yes | Source account ID |
| `destino` | UUID | Yes | Destination account ID |
| `valor` | integer (centavos) | Yes | Transfer amount (must be positive) |

**Success Response (201):**
```json
{
  "mov_origem": {
    "id": "uuid",
    "local_id": "uuid",
    "conta_id": "uuid",
    "lancamento_id": "uuid",
    "tipo": "transferencia_out",
    "valor": 50000,
    "saldo_anterior": 100000,
    "saldo_posterior": 50000,
    "data": "2026-11-01T10:30:00Z",
    "criado_em": "2026-11-01T10:30:00Z"
  },
  "mov_destino": {
    "id": "uuid",
    "local_id": "uuid",
    "conta_id": "uuid",
    "lancamento_id": "uuid",
    "tipo": "transferencia_in",
    "valor": 50000,
    "saldo_anterior": 50000,
    "saldo_posterior": 100000,
    "data": "2026-11-01T10:30:00Z",
    "criado_em": "2026-11-01T10:30:00Z"
  }
}
```

**Error Responses:**
| Code | Description |
|------|-------------|
| 201 | Transfer successful (see 201 as success above) |
| 401 | Missing or invalid JWT token |
| 403 | User lacks `caixa.operar` permission |
| 422 | Invalid UUIDs; invalid valor (must be positive); or account not found |
| 500 | Insufficient balance; or error creating linked transaction |

---

## Data Type Reference

All monetary values are represented as **centavos** (integers, e.g., R$ 100.00 = 10000).

**Lançamento.status:**
- `pendente` - Created but not yet confirmed
- `confirmado` - Confirmed and linked to an account movement
- `liquidado` - Fully settled
- `cancelado` - Cancelled with supervisor authorization

**Faturamento.status:**
- `aberto` - Invoice issued, awaiting payment
- `parcialmente_pago` - Partial payment received
- `pago` - Fully paid
- `cancelado` - Cancelled

**ContaReceber.status:**
- `pendente` - Receivable issued, not yet received
- `parcialmente_recebido` - Partial payment received
- `recebido` - Fully received
- `cancelado` - Cancelled

**Lançamento.tipo:**
- `recebimento` - Money in (customer payment, refund, etc.)
- `pagamento` - Money out (supplier payment, expense, etc.)
- `transferencia` - Internal transfer between accounts
- `ajuste` - Manual adjustment or correction

**Lançamento.origem:**
- `hospedagem` - Hotel stay payment
- `reserva` - Reservation-related
- `bar` - Bar/restaurant service
- `lavanderia` - Laundry service
- `rh` - Staff/payroll related
- `manual` - Manual entry

---

## Common Error Responses

All endpoints may return:

**401 Unauthorized**
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid authentication token"
}
```

**403 Forbidden**
```json
{
  "error": "Forbidden",
  "message": "User lacks required permission: caixa.operar"
}
```

**422 Unprocessable Entity**
```json
{
  "error": "Validation Error",
  "message": "Invalid UUID format",
  "fields": ["local_id"]
}
```

**500 Internal Server Error**
```json
{
  "error": "Internal Server Error",
  "message": "Database transaction failed"
}
```

---

## Testing with cURL

### List transactions:
```bash
curl -X GET "http://localhost:3000/api/financeiro/lancamentos?local_id=uuid&data_inicio=2026-11-01&data_fim=2026-11-30" \
  -H "Authorization: Bearer token"
```

### Generate billing:
```bash
curl -X POST "http://localhost:3000/api/financeiro/faturamento/gerar-cobranca" \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "faturamento_id": "uuid",
    "forma": "boleto"
  }'
```

### Confirm payment:
```bash
curl -X PUT "http://localhost:3000/api/financeiro/contas-receber/uuid/confirmar-pagamento" \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "valor": 50000,
    "conta_bancaria_id": "uuid"
  }'
```

### Get account balance:
```bash
curl -X GET "http://localhost:3000/api/financeiro/caixa-banco/saldo?conta_id=uuid&data=2026-11-01" \
  -H "Authorization: Bearer token"
```

### Transfer between accounts:
```bash
curl -X POST "http://localhost:3000/api/financeiro/caixa-banco/transferencia" \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "origem": "uuid",
    "destino": "uuid",
    "valor": 50000
  }'
```
