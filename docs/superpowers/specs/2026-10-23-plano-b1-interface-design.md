# ERP de Hotelaria — Plano B1: Interface de operação (recepção e governança)

**Data:** 2026-10-23
**Status:** em revisão
**Base:** `2026-10-22-nucleo-hospedagem-design.md` (seção 6 — Experiência de uso). Este documento detalha a primeira parte da interface (B1). As telas de cadastro e configuração ficam para o B2.

## 1. Objetivo

Dar à recepção e à governança uma interface completa para a operação do dia a dia, servida pelo próprio servidor local, que rode bem em PC com Windows 10 e 4 GB de RAM e em celulares e tablets da rede interna. Deve servir para demonstração a pousadas reais.

**Critérios de sucesso:**
- Uma recepcionista consegue, sem treinamento longo, fazer: reserva nova, registro de sinal, check-in, lançamento de extra, recebimento, check-out e fechamento de caixa.
- A tela "Hoje" mostra tudo o que precisa de ação no turno, cada item com seu botão de ação.
- Um único comando prepara uma pousada de demonstração com o mapa já povoado.

## 2. Decisões visuais (validadas com mockups)

- **Estilo acolhedor.** Tokens de cor:

| Token | Valor | Uso |
|---|---|---|
| `fundo` | `#faf6ef` | fundo da aplicação |
| `superficie` | `#fffdf8` | cartões, painéis |
| `borda` | `#eadfcd` | bordas e divisórias |
| `texto` | `#3b2f25` | texto principal |
| `texto-suave` | `#8a7663` | texto secundário |
| `verde` | `#2f6f5e` | menu lateral, confirmada, ações secundárias |
| `terracota` | `#c0613a` | ação principal, hospedado |
| `amarelo` | `#f2c879` | pré-reserva (aguardando sinal) |
| `alerta-fundo` | `#fbeee6` | bloco "Precisa da sua atenção" |

  Cantos arredondados (10–14 px nos cartões, pílula nos botões). Fonte do sistema (`system-ui`, Segoe UI), sem fontes externas.
- **Navegação:** menu lateral fixo à esquerda (verde), busca `Ctrl+K` e botão "+ Nova reserva" no topo, indicador de conexão no topo.
- **Detalhe da reserva:** painel deslizante à direita. O mapa continua visível e clicar em outra barra troca o conteúdo do painel.
- **Tela "Hoje":** layout aprovado no mockup `tela-hoje.html` (saudação + data + ocupação; 5 números; bloco "Precisa da sua atenção"; chegadas; saídas; governança agora; próximos dias).

## 3. Telas

| Tela | Perfis | Conteúdo e ações |
|---|---|---|
| Login | todos | Login e senha. Se `trocarSenha`, obriga a trocar antes de seguir (`PUT /api/usuarios/me/senha`). |
| Hoje (inicial da recepção) | recepção, admin | Saudação, data, ocupação do dia (ocupados/total e %). Números: chegadas (e quantas já entraram), saídas, hospedados (quartos e pessoas), quartos sujos (e em manutenção), livres hoje. **Atenção:** fila de itens acionáveis — sinal vencendo (registrar sinal / prorrogar), chegada atrasada (marcar no-show / telefone do hóspede), alertas abertos (ex.: conta com saldo, pagamento em reserva cancelada) com ação de abrir. **Chegadas:** quarto (ou "sem quarto"), hóspede, noites, pessoas, canal, situação (sinal pago, aguardando sinal, sem quarto, FNRH pendente, hospedada) e ação (Check-in / Escolher quarto). **Saídas:** quarto, hóspede, saldo, ação Check-out. **Governança agora:** quartos sujos e em manutenção (com motivo). **Próximos dias:** amanhã e depois, com chegadas, saídas e ocupação. |
| Mapa | recepção, admin | Quartos nas linhas (agrupados por categoria, com linha "sem quarto" por categoria), dias nas colunas; períodos de 7, 14 ou 30 dias; navegação anterior/próximo/hoje; filtro por categoria. Cores: terracota = hospedada, verde = confirmada, amarelo = pré-reserva, cinza = finalizada. Clicar em espaço vazio abre Nova reserva com quarto e data. Arrastar a barra troca quarto/datas; esticar a ponta direita muda a saída; em ambos mostra a prévia de valores (`/previa`) e só grava após confirmação. Clicar numa barra abre o painel da reserva. |
| Painel da reserva (deslizante) | recepção, admin | Cabeçalho (código, titular, quarto, datas, pessoas, situação). Abas: **Resumo** (canal, observações, sinal e prazo, diárias congeladas com detalhamento), **Conta** (extrato, saldo, lançar extra, receber pagamento, estornar), **Hóspedes** (titular e acompanhantes com pendências de FNRH). Ações conforme a situação: registrar sinal, prorrogar sinal, alterar, cancelar, no-show, check-in (com escolha de quarto sugerido e acompanhantes), check-out (prévia, pagamento dividido, faturado, late checkout). |
| Nova reserva | recepção, admin | Hóspede (busca por nome/CPF ou cadastro rápido com os campos da FNRH), categoria, quarto opcional, datas, adultos, idades das crianças, canal, desconto, observações. Mostra a cotação noite a noite com o detalhamento, as violações de restrição e o valor/prazo do sinal antes de confirmar. Também cria reserva de grupo (vários quartos). |
| Reservas | recepção, admin | Lista paginada com filtros: período, situação, canal e texto (nome ou código). Clicar abre o painel da reserva. |
| Caixa | recepção, admin | Se não houver turno aberto: abrir com valor inicial. Com turno aberto: movimentos do turno por forma e total esperado; fechar informando valores contados e ver o relatório de diferenças. |
| Governança | governança (e recepção) | Para celular: lista de quartos em botões grandes, sujos primeiro; tocar marca "limpo". Recepção/admin também colocam em manutenção, bloqueiam e liberam (com motivo). |
| Busca `Ctrl+K` | conforme permissão | Campo no topo com atalho; resultados de quarto, reserva e hóspede com as ações devolvidas pela API (`abrir`, `checkin`, `checkout`, `registrar_pagamento`, `lancar_extra`, `nova_reserva`, `ver_historico`, `ver_quarto`). |

O menu lateral mostra só o que o perfil pode usar. Governança entra direto na tela Governança.

## 4. Comportamento

- **Atualização:** dados de tela recarregados a cada 30 s e logo após cada ação, para que uma ação feita em um dispositivo apareça nos outros.
- **Erros de regra:** a mensagem (`mensagem`) da API aparece junto da ação que a causou, em português; nunca um alerta genérico.
- **Ações sensíveis:** janela de autorização com motivo e login/senha de supervisor, enviados no formato `{ motivo, supervisor: { login, senha } }`.
- **Sem conexão com o servidor:** faixa visível "Sem conexão com o servidor da pousada — tentando novamente", com nova tentativa automática; as ações ficam desabilitadas até voltar.
- **Sessão inválida (401):** volta ao login e, depois de entrar, retorna à tela onde estava.
- **Indicador "Online":** neste plano reflete a conexão com o servidor local. A conexão com a nuvem e a contagem de ações pendentes de envio entram no Plano C.
- **Dinheiro:** valores digitados em reais com vírgula e convertidos para centavos inteiros; exibidos sempre como `R$ 1.234,56`.
- **Datas:** exibidas como `DD/MM` ou `DD/MM/AAAA`; enviadas como `YYYY-MM-DD`.

## 5. Arquitetura

- Novo pacote `apps/web` (React + TypeScript + Vite) no mesmo monorepo.
- TanStack Query para chamadas e cache; React Router para rotas.
- Componentes visuais próprios (sem biblioteca de componentes), CSS com variáveis a partir dos tokens da seção 2.
- Arrastar e esticar no mapa com Pointer Events (mouse e toque), sem biblioteca externa.
- PWA: manifesto e ícone para instalar no celular. Sem cache offline de dados neste plano (o servidor local já é a peça offline).
- O servidor (`apps/server`) passa a servir o build da interface em `/` (arquivos estáticos) e mantém a API em `/api`. Rotas da interface que não existem como arquivo devolvem o `index.html`.
- Em desenvolvimento, o Vite faz proxy de `/api` para o servidor.

## 6. Ajustes necessários no servidor

A interface precisa de dados que a API do Plano A ainda não oferece:
- `GET /api/reservas` com filtros (`inicio`, `fim`, `estado`, `canal`, `q`) e paginação.
- Painel do dia ampliado: ocupação do dia (quartos ocupados, total, %), pessoas hospedadas, quartos livres hoje, quartos em manutenção (com motivo), chegadas já hospedadas no dia, telefone do titular nas chegadas atrasadas, saldo da conta nas saídas, situação de cada chegada (sinal pago/pendente, sem quarto, pendências de FNRH) e resumo dos próximos 2 dias.
- `GET /api/caixa/atual` devolvendo também os movimentos do turno e o total esperado por forma.
- `GET /api/canais` acessível à recepção (somente leitura) para o formulário de reserva.
- Servir os arquivos estáticos da interface.
- Script `npm run demo` que cria uma pousada de demonstração: 12 quartos em 3 categorias (Standard, Superior, Chalé), tabelas base, uma temporada alta, canais Balcão e Site, usuários `admin` (troca de senha obrigatória), `recepcao` e `governanca`, ~15 hóspedes e reservas distribuídas no mês corrente (hospedados, chegadas e saídas de hoje, uma pré-reserva com sinal vencendo, um grupo), relativo à data em que o script roda.

## 7. Testes

- **Componentes (Vitest + Testing Library):** posição e cor das barras do mapa; arrastar/esticar gerando a prévia correta; formatação e conversão de dinheiro e datas; formulário de nova reserva (validações, cotação exibida); janela de supervisor; exibição de erro da API junto da ação.
- **Ponta a ponta (Playwright, navegador real):** roteiro da recepcionista sobre a base de demonstração: login (com troca de senha) → Hoje → nova reserva → registrar sinal → check-in → lançar extra → check-out com pagamento dividido → fechar caixa sem diferença; e governança marcando quarto limpo no layout de celular.
- **Servidor:** testes para cada ajuste da seção 6.

## 8. Futuro registrado: Atendimento S&R via WhatsApp

Solicitação do dono do produto: integrar o WhatsApp na tela para **solicitações e reclamações (S&R)** dos hóspedes, para que a recepcionista atenda sem sair do sistema. Será um subprojeto próprio (com especificação própria). Preparação feita no B1: o bloco "Precisa da sua atenção" é implementado como uma **fila genérica de itens acionáveis** (tipo, título, detalhe, ações), de modo que um chamado de WhatsApp possa entrar como novo tipo de item sem refazer a tela.

## 9. Fora de escopo do B1

Telas de cadastro e configuração (B2), sincronização e indicador de nuvem (C), impressão, instalador e serviço do Windows (D), WhatsApp/S&R, bar e restaurante, estoque, financeiro.
