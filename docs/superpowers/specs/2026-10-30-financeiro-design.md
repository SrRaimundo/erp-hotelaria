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
3. Se forma = "debito" ou "credito" → movimento de cartão a receber da operadora (ver 12.2)

### Checkout Finalizado

**Evento:** `CheckoutFinalizado {checkout_id, cliente_id, valor_total, tipo_saida, pagamentos[], local_id}`

**Processamento:**
1. Para cada pagamento: cria Lançamento
2. Se forma = "dinheiro" ou "pix" → Movimento em Caixa/Banco
3. Se forma = "debito" ou "credito" → CartaoCredito
4. Se tipo_saida = "faturado" → cria Faturamento **aberto**. A ContaReceber só nasce quando o operador fecha a fatura (ver 12.1)

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

## 12. Decisões do dono (atualizam as seções 4 e 5)

Estas decisões prevalecem sobre o texto anterior.

### 12.1 Faturamento
- O checkout faturado deixa o fechamento **aberto** em Faturamento. O operador fecha a fatura na tela.
- **Agrupamento**: fechamentos do mesmo cliente e local podem ser reunidos numa fatura, por escolha do usuário na tela. Uma fatura = um número de documento = **uma** ContaReceber pela soma.
- **Extrato da cobrança** (tela e impressão): lista cada fechamento agrupado (reserva, hóspede, período, valor) e o total.

### 12.2 Cartão (cadastro Cobrança)
- Condições de cartão são um **cadastro** para contas a receber, por negociação com o adquirente: adquirente, bandeira, tipo (crédito, débito, voucher), prazo D+N (qualquer N), taxa % e ativo. Fica no grupo Cadastros, item "Cobrança" (`/cadastros/cobranca`), com a permissão `financeiro.gerenciar`.
- O movimento de cartão guarda uma **cópia** (snapshot) do prazo e da taxa na criação; mudar o cadastro depois não altera o histórico.
- Pagamento de cartão da hospedagem sem condição única para o tipo entra **sinalizado para revisão**, sem taxa nem prazo inventados; a baixa exige escolher a condição.
- A baixa credita só o **líquido** na conta. A taxa vira uma despesa **só de registro** em Contas a Pagar (origem "Cartão de Crédito", já liquidada), sem movimento de caixa, que nunca é paga, editada ou cancelada sozinha; estornar a baixa a remove. Entra nos relatórios como despesa à parte, fora do saldo (sem dupla contagem com o banco).
- O modelo `CartaoCredito` (fatura de cartão do hotel) da seção 4 foi substituído por `fin_cartao_movimento` (movimentos do PDV) e `fin_condicao_cartao`.

### 12.3 Pagamento parcial (contas a pagar e a receber)
- O usuário informa o valor pago e o **novo vencimento do saldo**. O original fica quitado pela parte paga e nasce uma nova parcela agendada, ligada ao original, com histórico visível. A soma é sempre o valor original.
- Reverter o pagamento parcial remove a parcela do saldo **somente se intocada**; senão a reversão é recusada com explicação.

### 12.4 Reversão
- Uma regra, uma rota: cancelar ou estornar devolve o saldo, restaura conta a receber, fatura e cartão ao estado anterior, uma única vez. O estorno de pagamento da hospedagem (`PagamentoEstornado`) é consumido; se o dinheiro já foi conciliado (cartão baixado, fatura fechada), abre alerta para decisão manual em vez de alterar.

### 12.5 Entrega dos eventos
- O Financeiro consome os eventos de hospedagem do `outbox` por um cursor persistido, em ordem, um evento e o avanço do cursor na mesma transação, com retentativa e alerta após falhas repetidas. Não há perda por queda do processo. A posição inicial em um banco existente é o maior `seq` presente (o histórico anterior não é reprocessado).
- **Sincronização com a nuvem** ("sincronizar ao conectar") é o Plano C e está fora do escopo desta fase. O Financeiro ainda não publica os próprios eventos no outbox.

### 12.6 Regras de reversão e origem (re-revisão)
- Lançamento originado na hospedagem (pagamento, faturado) só se desfaz na hospedagem; o Financeiro recusa e esconde a ação. O que nasce no Financeiro (contas a pagar, contas a receber manuais, recebimentos, cartão lançado à mão) se desfaz no Financeiro.
- Estornar o pagamento de uma conta a pagar devolve a conta a pendente com o valor cheio original; no pagamento parcial a parcela do saldo é removida (valor devolvido ao original) se intocada, senão a reversão é recusada. Idem para contas a receber.
- Estornar a baixa do cartão devolve o recebível a "a receber" (vínculo com o pagamento da hospedagem mantido) e remove a taxa; cancelar a venda é outra ação.
- Evento que não passa: tela "Fila do Financeiro" (config.gerenciar) com Tentar de novo e Ignorar evento (motivo, supervisor, auditado, com registro e alerta do valor).
- Chave de idempotência presa a rota, registro e conteúdo; chave igual com conteúdo diferente devolve 409.

### 12.7 Contas a Receber manual
- Lançamento à mão, espelho de Contas a Pagar: cliente (seleção ou cadastro rápido), local, documento, vencimento, valor, categoria e observação. Edita e cancela enquanto pendente e intocada; recebe total ou parcial (novo vencimento do saldo); estorna com as regras acima. Contas de origem hospedagem (faturas) não se editam nem se cancelam no Financeiro.

### 12.8 Título com várias parcelas (contas a pagar e a receber manual)
- Ao lançar, o usuário escolhe **À vista** (uma conta, como antes) ou **Parcelado**: número de parcelas (2 a 60), primeiro vencimento e intervalo: "A cada 30 dias" (contado da primeira data: 1ª, +30, +60...), "Todo mês no mesmo dia" (o dia 31 vira 30, 28 ou 29 quando o mês não tem) ou "Datas livres" (o usuário digita cada data e cada valor).
- Antes de salvar há uma **prévia** com data e valor editáveis. A divisão padrão põe as sobras de centavos na **primeira** parcela (R$ 1.000,00 / 3 = 333,34 + 333,33 + 333,33). Só salva se a soma for exatamente o total e as datas forem estritamente crescentes; a tela explica o que falta (Dicas) e o servidor confere de novo.
- Cada parcela é uma conta própria (a pagar: lançamento; a receber: conta manual), listada como "<documento> – parcela 2/4", com vencimento próprio, paga ou recebida sozinha. Pagamento ou recebimento parcial dentro da parcela continua valendo; a parcela do saldo se chama "<documento> – parcela 2/4 – saldo". Parcelas de título não se editam (cancele o título e lance de novo); estornar o pagamento de uma parcela segue as regras de 12.3 e 12.6, só nela.
- O **título** (`fin_titulo`) guarda documento, total, quantidade e intervalo, e agrupa as parcelas (`titulo_id`, `parcela_num`, `parcela_total`). Tudo é criado numa única transação, com chave de idempotência. A tela de detalhe mostra parcelas, pago, falta e histórico.
- **Cancelar título** (motivo e supervisor): cancela só as parcelas pendentes e intocadas; as pagas ou parcialmente pagas continuam, e a confirmação avisa quais. Relatórios e a lista de contas a receber enxergam cada parcela na sua data. Só nascem títulos manuais: a origem hospedagem continua sem edição nem reversão no Financeiro.
