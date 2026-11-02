# Relatórios do Hotel — primeira entrega

## 1. Objetivo

Dar à recepção os relatórios do dia a dia dentro do grupo Hotel, substituindo caderno e planilha. Todo relatório abre na tela, e o usuário pode **imprimir, exportar PDF ou compartilhar**.

Fora desta entrega: Resumo do dia, Previsão de ocupação, Desempenho e Reservas por canal (segunda entrega); relatórios de Financeiro, Estoque e Cadastros.

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

- `/relatorios`: catálogo em cartões, com nome e uma frase do que cada relatório traz, e a seção "Em breve" com os quatro da segunda entrega.
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
