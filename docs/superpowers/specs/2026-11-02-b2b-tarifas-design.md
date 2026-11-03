# B2b — Telas de tarifas, simulador e canais com comissão

## 1. Objetivo

Dar à pousada as telas para configurar tudo que o motor de tarifas já calcula, e enriquecer o cadastro de canais com tipo e comissão. O motor e as rotas `/api/tarifas/*` já existem; esta etapa constrói as telas e só altera o servidor no que diz respeito a canais.

## 2. Lugar no menu

No grupo Hotel, **Tarifas** aparece como subitem de Reservas, recuado logo abaixo dele. Rota `/reservas/tarifas`, permissão `tarifas.gerenciar`. O subitem não aparece sem a permissão.

A tela tem abas, cada uma com rota própria (`/reservas/tarifas/<aba>`): Tabela base, Temporadas, Dias da semana, Canais, Ocupação, Crianças, Pacotes, Restrições e Simulador. O Simulador só exige sessão com `reservas.gerenciar`, como a rota `/api/tarifas/simular`; quem não tem `tarifas.gerenciar` entra nele direto, pelo botão "Simular" da tela de reservas.

## 3. Canais

- Campos novos: `tipo` (`direta`, `ota`, `agencia`, `passante`) e `comissaoPercentual` (0 a 100, até duas casas).
- Canais existentes ficam com tipo `direta` e comissão 0; o dono ajusta na tela. `Balcão` continua a referência de preço e não pode ser removido.
- A reserva guarda `comissao_percentual` no momento em que é criada. Mudar o percentual do canal depois não altera reservas existentes. Reservas anteriores à migração ficam com 0.
- Alterar o canal da reserva troca o canal e recalcula a comissão guardada com o percentual atual do novo canal. Os preços da reserva não mudam (descontos, ajustes manuais e noites já lançadas ficam como estão); a prévia e a janela de alteração avisam disso. A auditoria registra canal e comissão antes e depois.
- O simulador exige `reservas.gerenciar`. Temporadas podem ser removidas (DELETE, com auditoria); reservas existentes guardam as noites já calculadas e não mudam de preço.
- Comissão incide sobre a receita de hospedagem da reserva.

## 4. Relatório Reservas por canal

A seção "No período" passa a mostrar também tipo, comissão (R$) e receita líquida, com total. A soma por tipo aparece no resumo do relatório. "Líquida" é a receita de hospedagem menos a comissão guardada em cada reserva, proporcional às noites dentro do período.

## 5. Telas

Todas seguem o padrão de Configurações: lista, `Gaveta` para editar, mensagens do servidor junto da ação, pt-BR, tokens CSS, dinheiro em `CampoDinheiro`, `Dicas` para explicar botão desabilitado. As rotas `PUT` dessas listas substituem o conjunto inteiro: a tela envia a lista completa e mostra a resposta do servidor.

- **Tabela base:** por categoria: 1, 2, 3 adultos, adulto extra, piso, teto.
- **Temporadas:** nome, período, tabela própria ou percentual; aviso de sobreposição, se o servidor recusar.
- **Dias da semana:** sete percentuais.
- **Canais:** nome, percentual sobre o Balcão, tipo, comissão.
- **Ocupação:** faixas (acima de x%, ajuste y%): a faixa vale quando a ocupação ultrapassa x.
- **Crianças:** faixas de idade e cobrança.
- **Pacotes:** nome, período, categoria, mínimo de noites, preço.
- **Restrições:** por data e categoria, conforme a rota existente.
- **Simulador:** categoria, chegada, saída, adultos, idades das crianças, canal → total e o valor noite a noite, mostrando o efeito de cada camada quando a rota o devolver.

## 6. Testes

Servidor: migração, guarda da comissão na criação e na troca de canal, percentual alterado sem mudar o passado, relatório com bruto, comissão e líquido. Web: cada aba carrega, salva o corpo esperado e mostra erro; subitem por permissão; simulador. e2e: alterar um percentual de temporada, simular, conferir o novo total.
