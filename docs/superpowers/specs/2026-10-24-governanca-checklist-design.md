# ERP de Hotelaria — Governança participativa: checklist do apartamento, chamados e frigobar

**Data:** 2026-10-24
**Status:** em revisão
**Base:** `2026-10-22-nucleo-hospedagem-design.md` (seção 5.8 Governança) e `2026-10-23-plano-b1-interface-design.md` (tela Governança e tela Hoje). Construído sobre o branch `plano-b1-interface`.

## 1. Objetivo

Trocar o botão simples "marcar limpo" por um **checklist do apartamento** preenchido pela camareira no celular, que registra o que foi feito, o enxoval recolhido, o estado dos equipamentos, a presença dos controles e o frigobar; abre **chamados** na hora; lança o consumo do frigobar quando a pousada assim trabalha; e decide se o apartamento volta para venda. Os registros formam a base de métricas e custos futuros (lavanderia, falhas por equipamento, controles perdidos, reposição de frigobar, tempo de limpeza, tempo de resolução de chamados).

**Critérios de sucesso:**
- Nenhum quarto sujo volta para venda sem um checklist de saída concluído.
- Um quarto só é **Liberado** com toda a limpeza "Sim" e sem chamado de **defeito** aberto.
- Todo bloqueio tem motivo.
- Um defeito ou controle faltando aparece para a recepção imediatamente, ainda com a camareira no quarto.
- O consumo de frigobar chega à conta do hóspede sem a recepção redigitar, e a conferência do check-out leva poucos toques.
- Cada checklist, chamado e reposição fica registrado com quem, quando e quanto tempo.

## 2. Conceitos

### 2.1 Modelos de checklist (configuráveis por pousada)

Cada pousada tem dois modelos: **Saída** (limpeza após o check-out) e **Diária** (arrumação de quarto ocupado). Cada modelo tem itens ordenados, agrupados em etapas, cada etapa com um tipo de resposta:

| Etapa | Tipo do item | Respostas |
|---|---|---|
| `limpeza` | sim/não | Sim, Não |
| `enxoval` | contagem | inteiro ≥ 0 (atalhos 0, 1, 2, 3, 4 e "+" para digitar) |
| `equipamento` | equipamento | Funciona, Não funciona, Não se aplica |
| `controles` | presença | Presente, Faltando, Não se aplica |

Itens podem ser desativados (não aparecem em novos checklists), nunca apagados, para preservar o histórico. A **tela de configuração** dos modelos fica para o B2; até lá valem os modelos padrão criados pela migração.

**Modelo padrão — Saída:**
- Limpeza: Banheiro limpo · Apartamento varrido e passado pano · Roupa de cama trocada · Piso do banheiro e toalhas trocados · Sabonetes, papel higiênico e utensílios repostos · Aromatizante aplicado
- Enxoval recolhido: Toalhas · Pisos · Lençóis de casal · Lençóis de solteiro
- Equipamentos: TV · Rádio · Ar-condicionado · Água quente
- Controles: Controle da TV · Controle do ar-condicionado

**Modelo padrão — Diária:**
- Limpeza: Banheiro limpo · Apartamento varrido · Toalhas e piso trocados · Amenidades repostas
- Enxoval recolhido: Toalhas · Pisos · Lençóis de casal · Lençóis de solteiro
- Controles: Controle da TV · Controle do ar-condicionado
- (sem equipamentos no padrão; a pousada poderá incluí-los quando houver a tela de configuração)

### 2.2 Setores e frigobar

- **Cadastro de produtos único:** um produto existe uma vez só ("Água mineral" é a mesma no frigobar, no freezer da recepção, no bar e no restaurante), com **preço único**.
- **Setor:** todo lançamento na conta registra o **setor** em que a venda aconteceu. Setores fixos nesta versão: `hospedagem` (diárias e taxas de early/late), `recepcao`, `frigobar`, `bar`, `restaurante`. Lançamentos existentes recebem `hospedagem` (diárias e taxas) ou `recepcao` (demais extras) na migração.
- **Onde cada produto é vendido:** o produto indica em quais setores aparece (marcação no próprio cadastro, ex.: Água mineral → Frigobar, Recepção, Bar). Só filtra listas; não duplica o produto. Os **produtos de frigobar** são os marcados para o setor Frigobar; trazem o preço, então ninguém digita valor.
- **Opção da pousada** `camareiraLancaFrigobar` (padrão: desligada), guardada na configuração da pousada.
- O frigobar aparece como **última etapa de conteúdo** do checklist (antes do resultado, na saída), com a lista de produtos de frigobar e botões 0 · 1 · 2 · 3 · + por produto:
  - **Arrumação diária, opção ligada:** a camareira informa o **consumo** de cada produto; o servidor lança cada item na conta do hóspede (setor Frigobar, origem "Governança", produto, quantidade) e registra a mesma quantidade como **reposição**.
  - **Arrumação diária, opção desligada:** a etapa não aparece.
  - **Limpeza de saída (sempre):** a camareira informa só a **reposição** (quanto colocou de cada produto); nada é cobrado.
- **Conferência no check-out:** feita pelo mensageiro ou pela recepção plantonista usando o login da recepção, no formulário rápido **Frigobar** do painel da reserva (seção 4.3). Lança o consumo na conta com setor Frigobar; não registra reposição (a reposição é registrada pela camareira na limpeza de saída).

### 2.3 Checklist (execução)

Uma execução registra: quarto, tipo (saída ou diária), camareira, início, fim, a resposta de cada item ativo (com **cópia do texto e da etapa do item** no momento), as quantidades de frigobar (consumo e/ou reposição por produto), a reserva hospedada (nas diárias) e — só na saída — o **resultado** (Liberado ou Bloqueado) e o motivo do bloqueio.

Execuções, respostas e registros de frigobar nunca são alterados nem apagados. O preenchimento acontece no celular; o servidor recebe o checklist inteiro ao "Concluir".

### 2.4 Chamados

Um chamado registra: quarto, **tipo**, descrição (ex.: "Ar-condicionado não funciona", "Controle da TV faltando"), observação opcional, quem abriu, quando, e o desfecho.

| Tipo | Origem | Impede "Liberado"? |
|---|---|---|
| `defeito` | equipamento "Não funciona" (saída ou diária) | **Sim** |
| `reposicao` | controle "Faltando" na limpeza de saída | Não |

Situações: `aberto` → `resolvido` (pela recepção, com observação opcional) ou `cancelado` (pela própria camareira, se desmarcar a resposta antes de concluir o checklist). Chamados nunca são apagados.

O chamado é criado **no momento** em que a camareira marca a resposta (com conexão), antes de o checklist ser concluído; a resposta do item guarda o id do chamado.

### 2.5 Controle faltando na arrumação diária

Na arrumação de quarto ocupado, controle "Faltando" **não** abre chamado: cria um **aviso para a recepção** na fila "Precisa da sua atenção" — "Controle da TV não encontrado no 105 — conferir com o hóspede" — com as ações **Abrir reserva** e **Resolver**. A recepção decide (o hóspede devolve, cobra ou registra perda) fora deste fluxo.

## 3. Regras

### 3.1 Checklist de saída
- Permitido só para quarto `sujo`.
- Todos os itens ativos precisam de resposta; frigobar aceita 0.
- Resultado **Liberado**: exige todos os itens de limpeza "Sim" e nenhum chamado de **defeito** `aberto` no quarto. Efeito: quarto `sujo → livre`. Chamados de reposição abertos não impedem.
- Resultado **Bloqueado**: exige motivo (texto não vazio). Se houver equipamentos "Não funciona", o motivo vem sugerido com seus textos ("Ar-condicionado não funciona; Água quente não funciona") e pode ser editado. Efeito: quarto `sujo → bloqueado` (nova transição permitida), com o motivo registrado.
- Um item de limpeza "Não" impede Liberado: a camareira corrige ou bloqueia com motivo.
- Controle "Faltando" abre chamado de reposição; frigobar registra apenas reposição.

### 3.2 Checklist diário (arrumação)
- Permitido só para quarto com reserva `hospedada`; a conta usada para o frigobar é a da reserva.
- Mesmas validações de resposta; sem resultado; sem mudança de situação do quarto.
- Equipamento "Não funciona" (se o modelo tiver) abre chamado de defeito; controle "Faltando" cria o aviso da seção 2.5.
- Frigobar (opção ligada): consumo lançado na conta e registrado como reposição, na mesma transação do checklist. Conta fechada → erro `CONTA_FECHADA` e nada é gravado.
- Pode haver mais de uma arrumação no mesmo dia hoteleiro.

### 3.3 Chamados e liberação
- **Liberar** um quarto `bloqueado` (ou `em_manutencao`) passa a exigir que não haja chamado de **defeito** `aberto` no quarto (erro `CHAMADO_ABERTO`, mensagem com a quantidade).
- Ao resolver o último chamado de defeito aberto de um quarto `bloqueado`, a resposta da API indica `podeLiberar: true` para a interface oferecer "Liberar quarto".
- Cancelar um chamado só é permitido a quem o abriu e enquanto não estiver resolvido.

### 3.4 Permissões
- Preencher checklists (incluindo o lançamento de frigobar da arrumação), abrir e cancelar os próprios chamados: `quartos.situacao` (governança e recepção). O lançamento de frigobar da camareira acontece dentro do checklist, sem exigir `conta.lancar`.
- Ver e resolver chamados, liberar quartos, resolver avisos: `quartos.manutencao` (recepção e admin).
- Formulário rápido de frigobar no check-out: `conta.lancar` (recepção).
- O botão antigo "marcar limpo" (`POST /api/quartos/:id/limpo`) deixa de existir na interface; a rota passa a responder `CHECKLIST_OBRIGATORIO` (422).

## 4. Telas

### 4.1 Governança (celular da camareira)
- Lista de quartos com a tarefa de cada um, nesta ordem: **Limpeza de saída** (sujos), **Arrumação** (ocupados sem arrumação no dia hoteleiro), **Bloqueados** (com motivo e nº de chamados abertos), demais.
- Cartão de ocupado já arrumado mostra "Arrumado às HH:MM" e permite nova arrumação.
- Tocar abre o checklist em etapas, uma por tela, botões grandes (etapas sem itens não aparecem):
  1. Limpeza — Sim / Não.
  2. Enxoval — 0 · 1 · 2 · 3 · 4 · + (o "+" abre campo numérico).
  3. Equipamentos — Funciona / Não funciona / Não se aplica. "Não funciona" mostra "O que aconteceu?" (opcional) e abre o chamado na hora ("Chamado aberto"). Voltar a "Funciona" pergunta "Cancelar o chamado aberto?".
  4. Controles — Presente / Faltando / Não se aplica. Na saída, "Faltando" abre chamado de reposição na hora; na arrumação, avisa a recepção ("Recepção avisada").
  5. Frigobar — lista de produtos com 0 · 1 · 2 · 3 · +. Título "Consumo do hóspede" na arrumação (opção ligada) e "Reposição" na saída.
  6. Resultado (só saída) — Liberado / Bloqueado; Liberado desabilitado com explicação quando há limpeza "Não" ou chamado de defeito aberto; Bloqueado mostra o motivo sugerido editável.
- "Voltar" / "Próxima etapa"; no fim, resumo (incluindo o total de frigobar lançado na conta, quando houver) e "Concluir".
- O checklist em andamento é salvo no próprio aparelho a cada resposta (por quarto e tipo) e retomado ao reabrir o quarto; ao concluir, o rascunho é apagado.
- Sem conexão: o checklist continua sendo preenchido; respostas que abrem chamado ou aviso mostram "Será registrado ao concluir" e são criadas no envio. "Concluir" fica desabilitado até a conexão voltar.

### 4.2 Recepção — tela Hoje
- Novo bloco **Chamados abertos**: tipo (Defeito / Reposição), quarto, descrição, observação, quem abriu, há quanto tempo, botão **Resolvido** (observação opcional). Após resolver o último chamado de defeito de um quarto bloqueado, o item mostra **Liberar quarto**.
- Avisos de controle faltando aparecem na fila "Precisa da sua atenção" (tipo `alerta`, já existente) com Abrir reserva e Resolver.
- Bloco **Governança agora**: quartos bloqueados com motivo e a quantidade de ocupados ainda não arrumados hoje.
- O contador de atenção do menu soma os chamados de defeito abertos.

### 4.3 Painel da reserva
- Aba Resumo: "Última arrumação: hoje às 10:42 por Ana" (ou "Sem arrumação hoje").
- Aba Conta (reserva `hospedada`): botão **Frigobar** que abre o formulário rápido — produtos de frigobar com 0 · 1 · 2 · 3 · + e total em reais; "Lançar" cria um lançamento por produto com quantidade > 0 (setor Frigobar). Pensado para a conferência do check-out pelo mensageiro ou plantonista.
- Os lançamentos de frigobar feitos pela camareira aparecem no extrato com setor Frigobar, origem "Governança" e a descrição do produto.
- Formulário de extra da aba Conta ganha o campo **Setor** (padrão Recepção; opções: Recepção, Frigobar, Bar, Restaurante) e a lista de produtos é filtrada pelo setor escolhido.
- O extrato mostra a coluna **Setor**.

### 4.4 Mapa
- Quarto bloqueado continua indisponível para reservas e mostra o motivo no mapa (já existente), agora com o nº de chamados de defeito abertos.

## 5. API (servidor)

- `GET /api/checklists/modelos` → modelos ativos com itens ativos, produtos de frigobar e a opção `camareiraLancaFrigobar` (`quartos.situacao`).
- `POST /api/quartos/:id/checklists` → `{ tipo: "saida" | "diaria", iniciadoEm, respostas: { itemId, simNao?, quantidade?, equipamento?, presenca?, observacao?, chamadoId?, alertaId? }[], frigobar?: { produtoId, quantidade }[], resultado?: "liberado" | "bloqueado", motivo? }`. Valida as regras da seção 3 numa transação; cria chamados/avisos pendentes (preenchidos offline); lança o consumo de frigobar (diária, opção ligada) e grava as reposições. Erros: `QUARTO_NAO_SUJO`, `QUARTO_NAO_OCUPADO`, `RESPOSTA_FALTANDO`, `LIMPEZA_INCOMPLETA`, `CHAMADO_ABERTO`, `MOTIVO_OBRIGATORIO`, `PRODUTO_NAO_FRIGOBAR`, `CONTA_FECHADA`. Evento `governanca.ChecklistConcluido`; auditoria.
- `POST /api/quartos/:id/chamados` → `{ itemId, observacao? }` cria chamado aberto (tipo deduzido da etapa do item); `POST /api/chamados/:id/cancelar` (quem abriu); `POST /api/chamados/:id/resolver` → `{ observacao? }` devolve `{ podeLiberar }`.
- `POST /api/quartos/:id/avisos-controle` → `{ itemId }` cria o aviso da seção 2.5 (usa `criarAlerta`, tipo `controle_faltando`); `POST /api/alertas/:id/cancelar` não é necessário — desmarcar antes de concluir chama `POST /api/alertas/:id/resolver` do próprio aviso.
- `GET /api/chamados?situacao=aberto` para a recepção.
- `POST /api/contas/:id/frigobar` → `{ reservaId, itens: { produtoId, quantidade }[] }` (recepção, `conta.lancar`): um lançamento por item com quantidade > 0, setor `frigobar`, na mesma transação.
- `POST /api/contas/:id/lancamentos` passa a aceitar `setor` (padrão `recepcao`); `GET /api/produtos?setor=` filtra pelos setores do produto; o cadastro de produto aceita `setores: string[]`.
- `GET /api/governanca` ampliado: `tarefa` (`limpeza_saida` | `arrumacao` | null), `arrumadoHojeEm`, `motivoBloqueio`, `chamadosAbertos`.
- Painel do dia: `chamadosAbertos` (lista) e `numeros.ocupadosSemArrumacao`.
- `obterReserva`: `ultimaArrumacao: { em, por } | null`.
- `liberar` passa a verificar chamados de defeito abertos.
- `PUT /api/config` aceita `camareiraLancaFrigobar` (admin).

## 6. Dados (novas tabelas, migrações na faixa `0500_governanca*`)

- `checklist_modelos(id, tipo UNIQUE)` — seeds Saída e Diária.
- `checklist_itens(id, modelo_id, etapa, texto, ordem, ativo)` — seeds da seção 2.1.
- `checklist_execucoes(id, quarto_id, tipo, reserva_id NULL, usuario_id, iniciado_em, concluido_em, resultado NULL, motivo NULL)`.
- `checklist_respostas(execucao_id, item_id, etapa, texto_item, sim_nao NULL, quantidade NULL, equipamento NULL, presenca NULL, observacao NULL, chamado_id NULL, alerta_id NULL)`.
- `frigobar_movimentos(id, execucao_id NULL, quarto_id, reserva_id NULL, produto_id, quantidade, tipo "consumo" | "reposicao", lancamento_id NULL, usuario_id, instante)` — consumo lançado pela camareira (com o id do lançamento na conta) e reposições; o formulário rápido do check-out grava só o lançamento na conta.
- `chamados(id, quarto_id, item_id NULL, tipo "defeito" | "reposicao", descricao, observacao NULL, situacao, aberto_por, aberto_em, encerrado_por NULL, encerrado_em NULL, observacao_encerramento NULL)` — única atualização permitida: a mudança de `aberto` para `resolvido`/`cancelado`.
- Configuração da pousada: campo `camareiraLancaFrigobar` (boolean, padrão falso).
- `lancamentos.setor` (nova coluna, `NOT NULL` com padrão; migração preenche os existentes: diárias e taxas de early/late → `hospedagem`, demais → `recepcao`). A coluna nasce com o lançamento e nunca é alterada.
- `produto_setores(produto_id, setor)` — em quais setores o produto aparece.

Execuções, respostas e movimentos de frigobar: somente inserção.

## 7. Demonstração

`semearDemonstracao` passa a incluir: produtos (Água mineral R$ 6,00, Refrigerante R$ 8,00, Cerveja R$ 12,00, Chocolate R$ 9,00) marcados para os setores Frigobar, Recepção e Bar; a opção `camareiraLancaFrigobar` ligada; um quarto `bloqueado` com motivo "Ar-condicionado não funciona" e o chamado de defeito aberto; um chamado de reposição aberto ("Controle da TV faltando"); um checklist de saída concluído ontem e duas arrumações de hoje (uma com consumo de frigobar lançado na conta).

## 8. Testes

- Servidor: cada regra da seção 3 (liberar com/sem limpeza completa e chamados de defeito abertos, reposição não impede, motivo obrigatório, transição sujo→bloqueado, diária só com hospedada, chamado/aviso offline criados no envio, cancelar só por quem abriu, liberar bloqueado com defeito aberto recusado, `podeLiberar`, consumo de frigobar lançado na conta só com a opção ligada, reposição gravada na saída sem cobrança, produto não marcado para o setor Frigobar recusado no checklist, setor gravado em cada lançamento e preenchido na migração, conta fechada não grava nada, formulário rápido do check-out).
- Interface: fluxo por etapas, contagens e "+", abertura/cancelamento de chamado e de aviso, Liberado desabilitado com explicação, motivo sugerido, etapa de frigobar conforme tipo e opção, rascunho salvo e retomado, bloco Chamados abertos com Resolvido → Liberar quarto, formulário Frigobar no painel da reserva.
- Ponta a ponta (navegador): camareira faz arrumação lançando 1 água no frigobar (aparece na conta); camareira faz limpeza de saída marcando o ar-condicionado com defeito e bloqueia; recepção vê o chamado, resolve e libera; o quarto fica livre no mapa.

## 9. Fora de escopo

Tela de configuração dos modelos e dos setores dos produtos (B2), cadastro de setores pela pousada, preço por setor, perfil de mensageiro e de manutenção, estoque de frigobar e de enxoval, custos por chamado, relatórios e métricas (os dados ficam prontos para eles), fotos no checklist, cobrança automática de controle perdido.
