# ERP de Hotelaria — Subprojeto 2: Módulo Financeiro

**Data:** 2026-10-30  
**Status:** aprovado para implementação  
**Prazo MVP:** 2 meses (funcional com Hospedagem e Reservas)

## 1. Contexto e Objetivo

O módulo Financeiro consolida todas as movimentações monetárias da operação. Funciona como um **barramento financeiro** que recebe eventos de múltiplos PDVs (Pontos de Venda) — Reservas, Recepção, Bar, Lavanderia, RH — e cria lançamentos automáticos, permitindo que o proprietário visualize a saúde financeira em tempo real.

**Diferencial:** 
- **Múltiplos locais** em um único servidor (Pousada, Sorveteria, etc., isolados).
- **Offline-first:** continua funcionando sem internet; sincroniza automaticamente quando retorna.
- **Auditoria completa:** toda ação registra usuário, motivo e assinatura.
- **Integração automática:** eventos de PDVs criam lançamentos sem intervenção manual.

## 2. Decomposição em Fases

### Fase 1 — MVP (2 meses)

Implementar **4 dos 6 fluxos** para viabilizar operação com Hospedagem e Reservas:

| # | Fluxo | Descrição |
|---|-------|-----------|
| 1 | **Locais + Cadastros** | Segregação por local; clientes, fornecedores, contas bancárias |
| 2 | **Contas a Receber** | Recebe checkouts faturados; rastreia recebiveis |
| 3 | **Caixa/Banco** | Consolida movimentos de dinheiro/PIX; saldos por conta |
| 4 | **Faturamento** | Recebe checkouts faturados; gera cobranças |

**Fase 2 (futuro):** Cartão de Crédito, Contas a Pagar

## 3. Arquitetura

### Princípios

1. **Cada Local é uma ilha:** lançamentos isolados por local.
2. **Eventos de PDVs alimentam Financeiro:** automático.
3. **Auditoria completa:** toda ação registrada.
4. **Offline-first:** operação sem internet; sincronização automática.
5. **Idempotência:** reenvio não duplica lançamento.
6. **Isolamento por setor:** Recepção não vê Financeiro.

## 4. Modelos de Dados

### Local

```typescript
Local {
  id: UUID
  pousada_id: UUID (fk Núcleo.Pousada)
  nome: string
  ativo: boolean
  parametros: {
    local_padrao_hospedagem: UUID,
    local_padrao_reserva: UUID
  }
}
```

### Cadastros (Cliente, Fornecedor, ContaBancaria, Moeda)

```typescript
Cliente {
  id: UUID
  local_id: UUID
  nome: string
  cpf_cnpj: string (unique per local)
  tipo: "pessoa_fisica" | "pessoa_juridica"
  contato: {email, telefone, endereco}
}

Fornecedor {
  id: UUID
  local_id: UUID
  razao_social: string
  cnpj: string
  contato: {email, telefone, endereco, banco}
}

ContaBancaria {
  id: UUID
  local_id: UUID
  nome: string
  banco: string
  agencia: string
  numero: string (unique per local)
  tipo: "corrente" | "poupanca"
  saldo_inicial: Dinheiro
}

Moeda {
  codigo: string ("BRL", "USD", etc)
  taxa_cambio: decimal
}
```

### Lançamento (Núcleo do Financeiro)

```typescript
Lancamento {
  id: UUID
  local_id: UUID
  data: date
  tipo: "recebimento" | "pagamento" | "transferencia" | "ajuste"
  origem: "hospedagem" | "reserva" | "bar" | "lavanderia" | "rh" | "manual"
  valor: Dinheiro
  forma_pagamento: "dinheiro" | "pix" | "debito" | "credito" | "cheque" | "boleto"
  status: "pendente" | "confirmado" | "liquidado" | "cancelado"
  referencia_id: UUID (checkout_id, reserva_id, etc)
  auditoria: {criado_por, data_criacao, dispositivo, motivo_cancelamento}
}
```

### Faturamento

```typescript
Faturamento {
  id: UUID
  local_id: UUID
  cliente_id: UUID
  referencia_id: UUID (checkout_id)
  valor_original: Dinheiro
  valor_liquido: Dinheiro
  data_vencimento: date
  forma_cobranca: "boleto" | "pix" | "deposito"
  numero_documento: string
  status: "aberto" | "parcialmente_pago" | "pago" | "cancelado"
  lançamentos_id: UUID[]
}
```

### ContaReceber

```typescript
ContaReceber {
  id: UUID
  local_id: UUID
  cliente_id: UUID
  numero_documento: string
  valor_original: Dinheiro
  valor_recebido: Dinheiro
  data_vencimento: date
  forma_pagamento: "boleto" | "pix" | "deposito" | "dinheiro"
  status: "pendente" | "parcialmente_recebido" | "recebido" | "cancelado"
  conta_destino_id: UUID
  lançamentos_id: UUID[]
}
```

### CartaoCredito

```typescript
CartaoCredito {
  id: UUID
  local_id: UUID
  numero_cartao: string (masked)
  bandeira: "visa" | "mastercard" | "elo"
  operadora: string
  data_fechamento: date
  data_vencimento: date
  valor_total: Dinheiro
  status: "aberto" | "fechado" | "liquidado"
  lançamentos_id: UUID[]
}
```

### Movimento (Caixa/Banco)

```typescript
Movimento {
  id: UUID
  local_id: UUID
  conta_id: UUID
  lançamento_id: UUID
  tipo: "credito" | "debito" | "transferencia_out" | "transferencia_in"
  valor: Dinheiro
  saldo_anterior: Dinheiro
  saldo_posterior: Dinheiro
  data: date
}

Saldo {
  id: UUID
  conta_id: UUID
  data: date
  saldo: Dinheiro
}
```

## 5. Fluxos de Integração

### Sinal de Reserva

**Evento:** `SinalReservaRecebido {reserva_id, cliente_id, valor, forma_pagamento, local_id}`

**Processamento:**
1. Cria Lançamento (tipo: recebimento, origem: reserva)
2. Se forma = "dinheiro" ou "pix" → Movimento em Caixa/Banco
3. Se forma = "debito" ou "credito" → CartaoCredito

### Checkout Finalizado

**Evento:** `CheckoutFinalizado {checkout_id, cliente_id, valor_total, tipo_saida, pagamentos[], local_id}`

**Processamento:**
1. Para cada pagamento: cria Lançamento
2. Se forma = "dinheiro" ou "pix" → Movimento em Caixa/Banco
3. Se forma = "debito" ou "credito" → CartaoCredito
4. Se tipo_saida = "faturado" → cria Faturamento + ContaReceber

### Recebimento Faturamento

**Ação:** Operador confirma pagamento de fatura

**Processamento:**
1. Cria Lançamento (tipo: recebimento, origem: faturamento)
2. Cria Movimento em Caixa/Banco (crédito na conta_destino)
3. Atualiza ContaReceber (valor_recebido += valor)
4. Atualiza Faturamento (status = pago se 100%)

### Transferência Entre Contas

**Ação:** Operador cria transferência

**Processamento:**
1. Cria Lançamento (tipo: transferencia)
2. Cria 2 Movimentos: débito em origem, crédito em destino

### Liquidação Cartão

**Ação:** Operador liquida cartão

**Processamento:**
1. Cria Lançamento (tipo: pagamento)
2. Cria Movimento em Caixa/Banco (crédito)
3. Atualiza CartaoCredito (status = liquidado)

### Contas a Pagar

**Ação 1:** Operador cria lançamento de fornecedor  
**Ação 2:** Operador baixa pagamento

**Processamento:**
1. Cria Lançamento (tipo: pagamento, status: pendente)
2. Ao pagar: atualiza status = confirmado
3. Cria Movimento em Caixa/Banco (débito)

## 6. Permissões e Segurança

### Perfis

| Perfil | Financeiro | Relatórios |
|--------|-----------|-----------|
| **Admin/Dono** | RW (tudo) | RW (tudo) |
| **Gerente Financeiro** | RW (seu local) | RW (seu local) |
| **Super Usuário Nível 1** | R (todos) | R (consolidado) |
| **Super Usuário Nível 2** | RW (todos, restrições) | RW (consolidado) |
| **Recepção** | ✗ | ✗ |

### Ações Sensíveis

Exigem **senha de supervisor** + **motivo**:
- Deletar lançamento
- Cancelar lançamento ou pagamento
- Ajustar saldo manual
- Estornar recebimento
- Mudar local de lançamento
- Alterar valor confirmado

## 7. Relatórios MVP

### 1. Fluxo de Caixa Diário
Saldo inicial + entradas + saídas = saldo final (por dia, por local)

### 2. Contas a Receber
Faturamentos abertos, parcialmente recebidos, recebidos (posição por data)

### 3. Movimento por Conta Bancária
Extrato detalhado (créditos, débitos, saldo)

### 4. Consolidado por Local
Comparativo de saldos e movimentos entre locais

### 5. Cartão de Crédito
Posição de cartões abertos/fechados e liquidações pendentes

## 8. Sincronização com Nuvem

**Padrão:** mesmo que Núcleo (Outbox + idempotência)

- Lançamentos criados no local → fila (Outbox)
- Quando internet: envia eventos em ordem
- Nuvem processa e confirma (ACK)
- Reenvio duplicado = ignorado (idempotência por UUID)
- Offline: operação contínua; sincroniza ao conectar

**Painel Nuvem:** read-only consolidado (todos os locais)

## 9. Fora de Escopo Fase 1

- Contas a Pagar completa (cheques, protocolos)
- Cartão de Crédito completo (arquivo de reconciliação)
- DRE, Fluxo Projetado
- Integração contábil, SPED
- Emissão real de boletos/arquivo remessa-retorno
- Automação PIX
- Multi-moeda

## 10. Critérios de Sucesso MVP

1. ✅ Lançamentos de Hospedagem (checkout pago) vão automaticamente para Caixa/Banco (dinheiro/PIX para caixa, débito/crédito para cartão)
2. ✅ Lançamentos de Reserva (sinal) vão automaticamente para Caixa/Banco
3. ✅ Faturamento recebe checkouts faturados e operador consegue gerar cobrança + confirmar recebimento
4. ✅ Relatórios MVP refletem exatamente o estado em tempo real
5. ✅ Funciona sem internet; sincroniza ao conectar (nada perdido)
6. ✅ Auditoria completa em ações críticas
7. ✅ Múltiplos bancos/contas suportados
8. ✅ Múltiplos locais isolados

## 11. Dependências

- Hospedagem (existe): eventos de checkout
- Reservas (existe): eventos de sinal
- Núcleo (existe): Local/Pousada, usuários, perfis
- Infra (existe): Barramento, Outbox, Sincronizador
- Bar/Restaurante (futuro): eventos de venda
- Estoque (futuro): eventos de saída
- RH (futuro): eventos de folha
