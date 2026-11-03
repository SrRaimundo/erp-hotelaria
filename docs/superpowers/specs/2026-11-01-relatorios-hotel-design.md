# Relatórios do Hotel — primeira entrega

## 1. Objetivo

Dar à recepção os relatórios do dia a dia dentro do grupo Hotel, substituindo caderno e planilha. Todo relatório abre na tela, e o usuário pode **imprimir, exportar PDF ou compartilhar**.

Fora desta entrega: relatórios de Financeiro, Estoque e Cadastros. Reservas por canal, Resumo do dia, Previsão de ocupação e Desempenho foram entregues depois da primeira lista.

## 2. Relatórios

| Id | Nome | Filtros | Conteúdo | Permissão |
|---|---|---|---|---|
| `check-in` | Lista de check-in | data (padrão: dia hoteleiro) | reservas ativas com chegada na data: código, hóspede, telefone, quarto, categoria, pessoas, noites, saldo, situação | `reservas.gerenciar` |
| `check-out` | Lista de check-out | data | todas as saídas da data (ativas e as já finalizadas, com situação "Saiu"; pendentes primeiro): mesmas colunas | `reservas.gerenciar` |
| `na-casa` | Hóspedes na casa | nenhum | reservas hospedadas: quarto, hóspede, telefone, entrada, saída, adultos, crianças; total de quartos e de pessoas | `reservas.gerenciar` |
| `cafe` | Lista do café da manhã | data | quem dormiu na noite anterior à data (`chegada < data <= saída`, reservas hospedadas ou confirmadas): quarto, hóspede, adultos, crianças; totais | `reservas.gerenciar` |
| `limpeza` | Limpeza dos apartamentos | nenhum | lista da governança de hoje: quarto, situação, serviço (saída ou arrumação), hospedado até, motivo; colunas em branco "Feito" e "Camareira" para preencher à mão | `reservas.gerenciar` |
| `conta` | Conta do hóspede | reserva | dados da estadia, extrato da conta, total de débitos, créditos e saldo | `reservas.gerenciar` |
| `hospedes` | Hóspedes cadastrados | busca por nome ou documento | nome, documento, telefone, e-mail, nº de estadias, última saída | `reservas.gerenciar`; gerar é auditado |
| `caixa` | Fechamento de caixa | período; turno | turnos do período; no turno escolhido: operador, abertura, fechamento, esperado, contado e diferença por forma, movimentos | `caixa.operar`; só os próprios turnos, exceto com `config.gerenciar` ou `supervisor` |
| `canais` | Reservas por canal | período (padrão: mês atual do dia hoteleiro) | "Hospedados agora" por canal (quartos, pessoas, % dos quartos); "No período" por canal (reservas, noites, receita de hospedagem em centavos, cancelamentos, no-shows, % das noites) e linha de totais | `reservas.gerenciar` |
| `resumo-dia` | Resumo do dia | data (padrão: dia hoteleiro) | chegadas, saídas, hospedados, ocupação, no-shows, cancelamentos e novas reservas; seção "Receita" (hospedagem, taxas, extras) e seção "Recebimentos por forma de pagamento" | `reservas.gerenciar` |
| `previsao` | Previsão de ocupação | início (padrão: hoje) e dias (padrão 14, máximo 90) | uma linha por dia: dia da semana, quartos disponíveis, ocupados, livres, ocupação, chegadas, saídas e receita prevista | `reservas.gerenciar` |
| `desempenho` | Desempenho | período (padrão: mês atual do dia hoteleiro) | seção "Total" e uma por categoria: quartos disponíveis e vendidos (em noites), ocupação, receita de quartos, diária média e RevPAR | `reservas.gerenciar` |

Regras do `resumo-dia`:
- Chegadas: reservas pré-reserva, confirmada, hospedada ou finalizada com chegada na data. Saídas: hospedada ou finalizada com saída na data. Hospedados: hospedada ou finalizada com chegada <= data < saída. Ocupação = hospedados ÷ quartos ativos.
- No-shows são os de chegada na data. Cancelamentos são os feitos no dia hoteleiro, pela auditoria. Novas reservas: criadas no dia hoteleiro.
- Receita: diária pela noite a que se refere (`data_ref`); extras, taxas (early check-in e late check-out) e estornos de lançamento pelo dia hoteleiro do lançamento, sendo o estorno somado na linha do lançamento original. Recebimentos: pagamentos e estornos de pagamento do dia hoteleiro, somados por forma (líquido de estornos), sem "faturado", que não passa pelo caixa. Conta de grupo não duplica: lançamentos e pagamentos são lidos uma vez, pela conta.

Regras da `previsao`:
- Conta pré-reservas, confirmadas, hospedadas e finalizadas (via `reserva_noites`); cancelada e no-show ficam de fora. O subtítulo diz isso.
- Quartos disponíveis = quartos ativos hoje. Bloqueio e manutenção são só a situação atual do quarto, sem data, então não são descontados de nenhum dia. Livres = disponíveis − ocupados, nunca negativo. Ocupação sem quartos mostra "—".

Regras do `desempenho`:
- Mesma base de quartos em todo o período (quartos ativos hoje × dias). Vendidos e receita vêm das mesmas `reserva_noites` do `canais` (estadias não canceladas nem no-show, só as noites do período); a receita total é igual à do `canais` no mesmo período.
- Diária média = receita ÷ vendidos; RevPAR = receita ÷ disponíveis, em centavos inteiros (arredondados). Divisão por zero mostra "—".

Regras do relatório `canais`:
- Período por sobreposição da estadia (chegada <= fim e saída > início). Estadia que cruza a borda conta só as noites dentro do período, e a receita é a das mesmas noites.
- Receita de hospedagem = soma de `reserva_noites.valor` das noites do período (o valor que a virada lança como diária; inclui desconto e acompanha saída antecipada e alteração de datas, e cobre noites futuras ainda não lançadas). Extras e taxas ficam fora.
- "Reservas" e "noites" contam pré-reserva, confirmada, hospedada e finalizada. Cancelada e no-show só entram nas colunas próprias, por sobreposição da estadia original, sem noites nem receita.
- Canal vazio aparece como "Sem canal". Linhas por noites decrescentes (empate por reservas, depois nome).
- Tela Hoje: o bloco "Ocupados por canal" usa os mesmos quartos hospedados do número "Hospedados" (`painel.ocupadosPorCanal`, soma = `numeros.hospedados`); difere de `ocupacao.ocupados`, que também conta pré-reservas e confirmadas que cobrem o dia.

Regras comuns:
- Data no formato `YYYY-MM-DD`, dinheiro em centavos, cálculo de "hoje" pelo dia hoteleiro.
- Quarto desativado continua aparecendo no histórico.
- Relatório vazio mostra "Nada para mostrar neste filtro", sem erro, e pode ser impresso.
- Hóspede sem quarto atribuído aparece com "a definir".
- Reservas canceladas e no-show ficam de fora de todas as listas.

## 3. Servidor

Pasta nova `apps/server/src/relatorios/`, com um arquivo por relatório. Só leitura: nenhuma migração nem gravação, exceto a auditoria de `hospedes`.

Todos devolvem o mesmo formato:

```ts
type Coluna = { chave: string; titulo: string; tipo: "texto" | "numero" | "dinheiro" | "data" | "em-branco" };
type Secao = { titulo?: string; colunas: Coluna[]; linhas: Record<string, string | number | null>[]; totais?: Record<string, string | number> };
type Relatorio = { id: string; titulo: string; subtitulo: string; geradoEm: string; resumo: { rotulo: string; valor: string }[]; secoes: Secao[] };
```

Rota única `GET /api/relatorios/:id` com os filtros na query. Id desconhecido → 404 `RELATORIO_NAO_ENCONTRADO`; falta de permissão → 403; filtro inválido → 422 com a mensagem do zod. Para escolher turno e reserva: `GET /api/relatorios/caixa/turnos?inicio&fim`, e a reserva vem da tela de reserva ou da busca existente.

## 4. Web

- `/relatorios`: catálogo em cartões, com nome e uma frase do que cada relatório traz (sem seção "Em breve" enquanto não houver relatório a anunciar).
- `/relatorios/:id`: filtros no topo, visor genérico que desenha qualquer `Relatorio`, e barra **Imprimir · Exportar PDF · Compartilhar**.
- Abrem como página normal do Shell, com botão Voltar.
- A tela da reserva ganha "Imprimir conta", que abre `/relatorios/conta?reserva=<id>`. A tela do caixa ganha "Relatório", que abre `/relatorios/caixa`.

Saídas:
- **Imprimir:** `window.print()` com CSS de impressão. Some o menu, a barra e os filtros; fica o cabeçalho com nome do estabelecimento, razão social, CNPJ, endereço, título, filtros, data e hora e usuário. Cabeçalho da tabela repete a cada página.
- **Exportar PDF:** gerado no navegador com `jspdf` e `jspdf-autotable`, carregados por `import()` só no clique, para não pesar em computador simples. A4; paisagem quando houver mais de 6 colunas. Nome do arquivo: `<id>-<data>.pdf`.
- **Compartilhar:** usa `navigator.share` com o PDF, só quando `navigator.canShare({ files })` for verdadeiro. Nas conexões sem HTTPS o botão não aparece, e fica o PDF.

Valores são formatados em um só lugar (dinheiro em R$, datas em dd/mm/aaaa), usados pelo visor e pelo PDF.

## 5. Permissões do menu

`/relatorios` continua exigindo `reservas.gerenciar`, para o menu da camareira seguir simples. O relatório de caixa dentro dele exige `caixa.operar`; quem não tem não vê o cartão.

## 6. Testes

- Servidor: cada relatório com dados reais de teste, cobrindo limites de data, cancelados de fora, permissões e auditoria de `hospedes`.
- Web: catálogo por permissão, filtros, visor com todos os tipos de coluna, vazio, botão Compartilhar oculto sem suporte, PDF com o gerador simulado.
- e2e: abrir a lista de check-in, trocar a data, baixar o PDF e conferir que o arquivo começa com `%PDF`.
