# API Reference - Financeiro Module

HTTP API endpoints for the Financeiro (Financial) module. All routes are prefixed with `/api/financeiro` and require the `financeiro.gerenciar` permission.

## Authentication & Authorization

All endpoints require:
- **Authentication**: Valid JWT token in `Authorization: Bearer <token>` header (enforced by `/api` hook)
- **Permission**: `financeiro.gerenciar` (checked at route level)
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
| 403 | User lacks `financeiro.gerenciar` permission |
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
| 403 | User lacks `financeiro.gerenciar` permission; or supervisor authorization failed |
| 422 | Invalid UUID or missing required body fields |
| 500 | Transaction not found or already cancelled |

---

### Faturamento (Invoicing)

Invoices are closed through `POST /api/financeiro/faturamentos/fechar-grupo` (one or more open closings of the same client; see the addendum at the end).
The old `POST /faturamento/gerar-cobranca` route was removed: it generated a document number without creating the Conta a Receber and left the invoice stranded.

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
| 403 | User lacks `financeiro.gerenciar` permission |
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
| 403 | User lacks `financeiro.gerenciar` permission |
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
| 403 | User lacks `financeiro.gerenciar` permission |
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
  "message": "User lacks required permission: financeiro.gerenciar"
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

---

## Addendum: rotas da fase 1b (locais, contas, contas a pagar, cartão, fechamento de fatura)

Todas exigem `financeiro.gerenciar`. Valores em centavos; erros de domínio devolvem 422 e dados inválidos 400.
Dias (`data`, `data_inicio`, `data_fim`, relatórios) são contados no fuso da pousada (`config.fuso`).

| Rota | Descrição |
|------|-----------|
| `GET /api/financeiro/locais` | Lista todos os locais, com `ativo` e `hospedagem_padrao`. |
| `POST /api/financeiro/locais` | `{ nome, hospedagem_padrao? }`. Cria o local (e a conta "Caixa"). |
| `PUT /api/financeiro/locais/:id` | `{ nome?, ativo?, hospedagem_padrao? }`. Renomeia, desativa ou marca como o local que recebe a hospedagem. |
| `GET /api/financeiro/contas?local_id=` | Contas do local com `saldo` atual. |
| `POST /api/financeiro/contas` | `{ local_id, nome, banco, agencia, numero, tipo, saldo_inicial }`. `tipo`: corrente, poupanca, aplicacao, caixa. |
| `GET/POST /api/financeiro/fornecedores` | Lista (`?local_id=`) e cadastra `{ local_id, razao_social, cnpj? }`. |
| `GET /api/financeiro/clientes?local_id=` | Clientes com `contato` e `politica` de faturamento. |
| `PUT /api/financeiro/clientes/:id` | `{ contato?: {email, telefone, endereco}, politica?: {prazo_dias, forma_cobranca, observacoes} }`. |
| `GET /api/financeiro/lancamentos?local_id=&tipo=` | Ganhou o filtro `tipo` e os campos `descricao`, `categoria`, `vencimento`, `fornecedor_nome`. |
| `POST /api/financeiro/contas-a-pagar` | `{ local_id, descricao, categoria, valor, vencimento, fornecedor_id? }`. `categoria`: fornecedor, servico, funcionario, contrato. Nasce `pendente`. |
| `PUT /api/financeiro/contas-a-pagar/:id/baixar` | `{ conta_id, forma_pagamento? }`. Confirma e debita a conta. |
| `GET /api/financeiro/faturamentos?local_id=` | Faturamentos com cliente, reserva e `fechada` (cobrança gerada). |
| `POST /api/financeiro/faturamentos/:id/fechar` | `{ forma, data_vencimento }`. Gera o documento e envia a Contas a Receber. |
| `GET /api/financeiro/cartao/movimentos?local_id=` | Movimentos de cartão: bandeira, tipo, bruto, taxa, líquido, previsão, status. |
| `POST /api/financeiro/cartao/movimentos` | `{ local_id, data, bandeira, tipo, valor, informado: "bruto"\|"liquido", taxa_percentual, previsao? }`. |
| `PUT /api/financeiro/cartao/movimentos/:id/baixar` | `{ conta_id, taxa_percentual? }`. Credita o líquido na conta. |

### Reversão (cancelar e estornar)

Uma regra só, uma vez só por lançamento: `POST /api/financeiro/lancamentos/:id/estornar` e `DELETE /api/financeiro/lancamentos/:id`
(`{ motivo, supervisor: {login, senha} }`). Ambos devolvem o saldo (movimento oposto), restauram a conta a receber e a fatura
(recebimento) e cancelam o movimento de cartão com a sua taxa. A segunda tentativa, ou cancelar depois de estornar, é recusada (422).
Pagamento parcial: a parcela do saldo só é removida junto se ninguém mexeu nela; senão a reversão é recusada com explicação.
A taxa de cartão e o estorno em si não podem ser revertidos sozinhos.

### Pagamento parcial

- `PUT /contas-a-pagar/:id/baixar` aceita `valor` e `novo_vencimento`; `PUT /contas-receber/:id/confirmar-pagamento` aceita `novo_vencimento`.
  Pagar/receber menos que o devido exige `novo_vencimento`: o original fica quitado pela parte paga e nasce uma nova parcela (campo `parcela_de`)
  com o saldo. A soma das parcelas é sempre o valor original (`valor_total` guarda o valor antes da divisão).

### Faturamento agrupado

- `POST /faturamentos/fechar-grupo` `{ ids[], forma, data_vencimento }`: mesmo cliente e local, todos abertos. Um número de documento, uma conta a receber pela soma.
- `GET /faturamentos/extrato?local_id=&numero=`: cada fechamento da fatura (reserva, hóspede, período, valor) e o total.

### Cobrança (condições de cartão)

- `GET/POST /cobranca/condicoes`, `PUT /cobranca/condicoes/:id`: adquirente, bandeira, tipo, `prazo_dias` (D+N qualquer) e `taxa_percentual`, `ativo`.
- O movimento de cartão guarda uma cópia do prazo e da taxa na criação. Pagamento de cartão da hospedagem sem condição única do tipo entra com `revisar: 1`
  (sem taxa nem prazo inventados) e só é baixado informando `condicao_id` (ou a taxa).
- A taxa descontada na baixa vira um lançamento de pagamento "liquidado" (categoria `taxa_cartao`), sem movimento de caixa: o banco recebeu só o líquido.
  Aparece em Contas a Pagar e em `taxas_cartao` dos relatórios de fluxo e consolidado, fora do saldo.
Checkouts faturados da hospedagem ficam em Faturamento aberto até `fechar`; só então viram Conta a Receber.
Pagamentos em cartão da hospedagem viram movimentos de cartão a receber (taxa 0 até a baixa).

### Reversão: origem e regras (atualização)

- Lançamento que veio da hospedagem (`referencia_tipo: hospedagem_pagamento`) NÃO se estorna nem se cancela no Financeiro (422, "estorne-o na hospedagem"). Cartão baixado também não pela rota genérica: use `POST /cartao/movimentos/:id/estornar-baixa` `{ motivo, supervisor }`, que devolve o cartão a `a_receber` (mantendo o vínculo com o pagamento) e remove a taxa.
- Conta a pagar paga: estornar ou cancelar desfaz o pagamento e devolve a conta a `pendente` com o valor cheio (a parcela de saldo intocada é removida; mexida, recusa). Conta pendente só se cancela (`DELETE`); estornar uma conta não paga é recusado.
- `Idempotency`: a `chave` vale para o caminho (com o id do registro) e o conteúdo. A mesma chave com conteúdo diferente devolve 409 (`CHAVE_REUSADA`).

### Conta a receber lançada à mão

- `POST /contas-receber` `{ local_id, cliente_id, numero_documento, valor, vencimento, categoria, observacao?, forma_pagamento? }`. `categoria`: servico, aluguel, evento, convenio, outros.
- `PUT /contas-receber/:id`: edita enquanto pendente e intocada. `POST /contas-receber/:id/cancelar` `{ motivo, supervisor }`. Contas de origem `faturamento` (hospedagem) são recusadas.
- Receber (total ou parcial com `novo_vencimento`) e estornar o recebimento usam as rotas já descritas. A lista (`/relatorios/contas-receber`) traz `origem`, `categoria`, `observacao`, `editavel` e `lancamento_id` (último recebimento).
- `POST /clientes` `{ local_id, nome, cpf_cnpj? }`: cadastro rápido (documento único por local).

### Fila (permissão `config.gerenciar`)

- `GET /fila`: posição, pendentes, evento bloqueado (tipo, valor, erro, tentativas) e eventos ignorados.
- `POST /fila/tentar-novamente`; `POST /fila/ignorar` `{ seq, motivo, supervisor }` (só o evento que bloqueia a fila; auditado, com registro em `fin_evento_ignorado` e alerta com o valor).

### Título com várias parcelas (contas a pagar e a receber manual)

- `POST /api/financeiro/titulos` `{ chave?, tipo: "pagar"|"receber", local_id, documento, valor_total, intervalo: "30_dias"|"mensal"|"livre", categoria, fornecedor_id? (pagar), cliente_id (receber), forma_pagamento?, observacao?, parcelas: [{ vencimento: "AAAA-MM-DD", valor }] }`. Valores em centavos. 201 com o detalhe do título.
  - Regras (422 com mensagem em português): de 2 a 60 parcelas; datas existentes e estritamente crescentes; cada valor maior que zero; a soma das parcelas é exatamente `valor_total`; documento a receber único no local. Criação numa transação; a `chave` repete a mesma resposta (409 se o conteúdo mudar).
  - O cliente calcula a prévia (divisão com sobra de centavos na primeira parcela; intervalo `30_dias` conta da primeira data; `mensal` mantém o dia, ajustando ao último dia do mês); `intervalo` é só informativo, o servidor grava as datas e valores enviados.
- `GET /api/financeiro/titulos/:id` devolve `{ id, tipo, documento, valor_total, num_parcelas, intervalo, status: "ativo"|"cancelado", pago, restante, parcelas: [{ id, numero, total, rotulo, vencimento_dia, valor, pago, restante, situacao: "pendente"|"parcial"|"pago"|"cancelado", saldo_de }], historico: [{ instante, ator, acao, motivo }] }`. A parcela de saldo de um pagamento parcial entra com o rótulo "... – parcela 2/4 – saldo".
- `POST /api/financeiro/titulos/:id/cancelar` `{ motivo, supervisor }`: cancela só as parcelas pendentes e intocadas (as pagas ou parcialmente pagas ficam); 422 se não há parcela pendente ou se o título já foi cancelado.
- Cada parcela segue as rotas de sempre: `PUT /contas-a-pagar/:id/baixar`, `PUT /contas-receber/:id/confirmar-pagamento`, `POST /lancamentos/:id/estornar`. `GET /lancamentos` traz `titulo_id`, `parcela_num` e `parcela_total`; `GET /relatorios/contas-receber` traz também `rotulo` e `cancelavel`. Parcela de título a receber não se edita (`editavel: false`); `PUT /contas-receber/:id` responde 422.
- Migração `0790_financeiro_titulo`: tabela `fin_titulo` e as colunas `titulo_id`, `parcela_num`, `parcela_total` em `fin_lancamento` e `fin_conta_receber`.
