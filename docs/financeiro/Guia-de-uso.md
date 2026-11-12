# Financeiro: guia de uso

Para o dono e para quem trabalha no financeiro. Só quem tem a permissão do Financeiro (o administrador, por padrão) vê o grupo **Financeiro** e o item **Cobrança** do grupo Cadastros. A recepção não vê nada disso.

## Como o dinheiro entra sozinho

Tudo o que a recepção registra na conta do hóspede chega ao Financeiro sem digitar de novo:

- **Dinheiro e Pix** viram lançamento e entram na conta do tipo Caixa do local.
- **Cartão de débito e crédito** viram um movimento em **Cartão de Crédito**, a receber da operadora.
- **Faturado** (check-out com valor faturado) vira um fechamento em **Faturamento**.
- **Estorno do pagamento** na hospedagem desfaz o lançamento e o saldo, uma única vez. Se o cartão já foi baixado ou a fatura já foi fechada, nada muda sozinho: aparece um alerta para você decidir.

Se o servidor cair no meio, nada se perde: ao voltar, o Financeiro retoma do ponto em que parou. Se um evento não conseguir ser registrado, o sistema tenta de novo sozinho e, depois de três falhas, abre um alerta.

Este recurso funciona sem internet. O envio dos dados para a nuvem é uma etapa futura (Plano C) e ainda não existe.

## Local

Cada local é uma ilha: lançamentos, contas e faturas não se misturam. Em **Local** você cria, renomeia e desativa locais. Marque **Recebe os lançamentos da hospedagem** no local que deve receber o que vem da recepção (não dá para desativar esse local sem marcar outro). Se não houver nenhum local, o primeiro pagamento cria o local "Principal".

## Contas a Pagar

Fornecedores, serviços, funcionários e contratos. **+ Nova conta a pagar**, escolha o tipo, a descrição, o valor e o vencimento. Cadastre um fornecedor novo ali mesmo, se precisar.

- **Pagar**: escolha a conta de onde sai o dinheiro e a forma. O saldo da conta diminui.
- **Pagamento parcial**: digite o valor pago. Informe o **novo vencimento do saldo**. A conta original fica paga pela parte paga e nasce uma nova parcela, ligada a ela, com o resto. A soma é sempre o valor original.
- **Cancelar**: pede motivo e a senha de um supervisor.
- A **taxa do cartão** aparece aqui como despesa do "Cartão de Crédito", já liquidada. Ela é só um registro: não mexe no saldo, não se paga e não se cancela sozinha.

## Contas a Receber

Faturas fechadas em Faturamento. **Confirmar pagamento** pede o valor e a conta de destino. Receber só uma parte funciona como no pagamento: informe o novo vencimento do saldo e o restante vira uma nova parcela.

## Cartão de Crédito

Movimentos de crédito, débito e voucher. **+ Novo movimento** usa uma condição cadastrada em **Cadastros, Cobrança**; informe se o valor é bruto ou já líquido da taxa. A tela mostra bruto, taxa, líquido e a previsão (D+N). **Baixar** leva o líquido para a conta escolhida.

Pagamentos de cartão que vêm da hospedagem entram com a etiqueta **Revisar condição** quando não há uma única condição cadastrada para o tipo. Nesse caso a baixa pede que você escolha a condição.

## Cobrança (em Cadastros)

As condições do cartão negociadas com cada adquirente: adquirente, bandeira, tipo, prazo (D+N, qualquer N), taxa e se está ativa. Mudar uma condição vale daqui para frente: os movimentos já registrados guardam o prazo e a taxa da época.

## Caixa e Banco

Saldo de cada conta do local, movimentos dos últimos 30 dias, **+ Nova conta** (com saldo inicial) e **Transferir**. Em cada movimento, **Estornar** desfaz o lançamento de origem (pede motivo e supervisor): o saldo volta, a conta a receber e a fatura voltam ao estado anterior e o cartão é cancelado. Só se estorna uma vez. Se o lançamento foi um pagamento parcial e a parcela do saldo já foi movimentada, o sistema recusa e explica; estorne antes o que foi feito nela.

## Faturamento

Mostra os fechamentos marcados para faturar. Para fechar uma fatura:

1. Clique em **Fechar fatura** na linha, ou marque vários fechamentos **do mesmo cliente** e use o botão de cima para reuni-los numa só fatura.
2. Confira os dados do cliente e a política (prazo, forma de cobrança), ajuste o vencimento e confirme.

A fatura vira **uma** conta a receber pela soma. Em **Fechadas**, o botão **Extrato** mostra cada fechamento (reserva, hóspede, período, valor) e o total, e **Imprimir** imprime só o extrato.

## Relatórios

Fluxo de caixa do dia, consolidado por local, contas a receber, extrato da conta e posição do cartão. O dia segue o fuso da pousada. As taxas de cartão aparecem à parte: são despesa de registro e não entram no saldo.

## Ao colocar em uso um banco que já tem histórico

O Financeiro começa a contar a partir da instalação: pagamentos e sinais anteriores não são importados. A conta Caixa nasce com saldo zero. Para um saldo de abertura, crie uma conta com o saldo inicial e transfira.

## Cuidados

- Clicar duas vezes numa ação de dinheiro não duplica o efeito.
- Nada é apagado: cancelamentos e estornos ficam registrados com motivo e quem autorizou.
