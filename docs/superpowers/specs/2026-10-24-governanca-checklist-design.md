# ERP de Hotelaria — Governança participativa: checklist do apartamento e chamados

**Data:** 2026-10-24
**Status:** em revisão
**Base:** `2026-10-22-nucleo-hospedagem-design.md` (seção 5.8 Governança) e `2026-10-23-plano-b1-interface-design.md` (tela Governança e tela Hoje). Construído sobre o branch `plano-b1-interface`.

## 1. Objetivo

Trocar o botão simples "marcar limpo" por um **checklist do apartamento** preenchido pela camareira no celular, que registra o que foi feito, o enxoval recolhido e o estado dos equipamentos, abre **chamados** de defeito na hora e decide se o apartamento volta para venda. Os registros formam a base de métricas e custos futuros (lavanderia, falhas por equipamento, tempo de limpeza, tempo de resolução de chamados).

**Critérios de sucesso:**
- Nenhum quarto sujo volta para venda sem um checklist de saída concluído.
- Um quarto só é **Liberado** com toda a limpeza "Sim" e sem chamado aberto.
- Todo bloqueio tem motivo.
- Um defeito marcado pela camareira aparece para a recepção imediatamente, ainda com a camareira no quarto.
- Cada checklist e cada chamado fica registrado com quem, quando e quanto tempo.

## 2. Conceitos

### 2.1 Modelos de checklist (configuráveis por pousada)

Cada pousada tem dois modelos: **Saída** (limpeza após o check-out) e **Diária** (arrumação de quarto ocupado). Cada modelo tem itens ordenados, agrupados em etapas, cada um com um tipo:

| Etapa | Tipo do item | Respostas |
|---|---|---|
| `limpeza` | sim/não | Sim, Não |
| `enxoval` | contagem | número inteiro ≥ 0 (atalhos 0, 1, 2, 3, 4 e "+" para digitar) |
| `equipamento` | equipamento | Funciona, Não funciona, Não se aplica |

Itens podem ser desativados (não aparecem em novos checklists) mas nunca apagados, para preservar o histórico. A **tela de configuração** dos modelos fica para o B2; até lá valem os modelos padrão criados pela migração.

**Modelo padrão — Saída:**
- Limpeza: Banheiro limpo · Apartamento varrido e passado pano · Roupa de cama trocada · Piso do banheiro e toalhas trocados · Sabonetes, papel higiênico e utensílios repostos · Aromatizante aplicado
- Enxoval recolhido: Toalhas · Pisos · Lençóis de casal · Lençóis de solteiro
- Equipamentos: TV · Rádio · Ar-condicionado · Água quente

**Modelo padrão — Diária:**
- Limpeza: Banheiro limpo · Apartamento varrido · Toalhas e piso trocados · Amenidades repostas
- Enxoval recolhido: Toalhas · Pisos · Lençóis de casal · Lençóis de solteiro
- (sem equipamentos no padrão; a pousada poderá incluí-los quando houver a tela de configuração)

### 2.2 Checklist (execução)

Uma execução registra: quarto, tipo (saída ou diária), camareira, início, fim, a resposta de cada item ativo (com **cópia do texto e da etapa do item** no momento, para o histórico não mudar se o item for renomeado), e — só na saída — o **resultado** (Liberado ou Bloqueado) e o motivo do bloqueio. A reserva hospedada no quarto é registrada nas execuções diárias.

Execuções e respostas nunca são alteradas nem apagadas. O preenchimento acontece no celular; o servidor recebe o checklist inteiro ao "Concluir".

### 2.3 Chamados

Um chamado registra: quarto, descrição (texto do item com defeito, ex.: "Ar-condicionado não funciona"), observação opcional da camareira, quem abriu, quando, e o desfecho. Situações: `aberto` → `resolvido` (pela recepção, com observação opcional) ou `cancelado` (pela própria camareira, se desmarcar o defeito antes de concluir o checklist). Chamados nunca são apagados.

O chamado é criado **no momento** em que a camareira marca "Não funciona" (com conexão), antes de o checklist ser concluído. A resposta do item guarda o id do chamado.

## 3. Regras

### 3.1 Checklist de saída
- Permitido só para quarto `sujo`.
- Todas as perguntas dos itens ativos precisam de resposta.
- Resultado **Liberado**: exige todos os itens de limpeza "Sim" e nenhum chamado `aberto` no quarto. Efeito: quarto `sujo → livre`.
- Resultado **Bloqueado**: exige motivo (texto não vazio). Se houver itens "Não funciona", o motivo vem sugerido com seus textos ("Ar-condicionado não funciona; Água quente não funciona") e pode ser editado. Efeito: quarto `sujo → bloqueado` (nova transição permitida), com o motivo registrado.
- Um item de limpeza "Não" impede Liberado: a camareira corrige (volta e marca Sim após refazer) ou bloqueia com motivo.

### 3.2 Checklist diário (arrumação)
- Permitido só para quarto com reserva `hospedada`.
- Mesmas validações de resposta; sem resultado, sem mudança de situação do quarto.
- Se o modelo diário tiver itens de equipamento, "Não funciona" também abre chamado; o quarto continua ocupado.
- Pode haver mais de uma arrumação no mesmo dia hoteleiro.

### 3.3 Chamados e liberação
- **Liberar** um quarto `bloqueado` (ou `em_manutencao`) passa a exigir que não haja chamado `aberto` no quarto (erro `CHAMADO_ABERTO`, mensagem com a quantidade).
- Ao resolver o último chamado aberto de um quarto `bloqueado`, a resposta da API indica `podeLiberar: true` para a interface oferecer "Liberar quarto".
- Cancelar um chamado só é permitido a quem o abriu e enquanto não estiver resolvido.

### 3.4 Permissões
- Preencher checklists, abrir e cancelar os próprios chamados: `quartos.situacao` (governança e recepção).
- Ver e resolver chamados, liberar quartos: `quartos.manutencao` (recepção e admin).
- O botão antigo "marcar limpo" (`POST /api/quartos/:id/limpo`) deixa de existir na interface; a rota passa a responder `CHECKLIST_OBRIGATORIO` (422).

## 4. Telas

### 4.1 Governança (celular da camareira)
- Lista de quartos com a tarefa de cada um, nesta ordem: **Limpeza de saída** (sujos), **Arrumação** (ocupados sem arrumação no dia hoteleiro), **Bloqueados** (com motivo e nº de chamados abertos), demais.
- Cartão de ocupado já arrumado mostra "Arrumado às HH:MM" e permite nova arrumação.
- Tocar abre o checklist em etapas, uma por tela, botões grandes:
  1. Limpeza — Sim / Não por item.
  2. Enxoval — 0 · 1 · 2 · 3 · 4 · + (o "+" abre campo numérico).
  3. Equipamentos (quando o modelo tiver itens dessa etapa) — Funciona / Não funciona / Não se aplica. "Não funciona" mostra o campo "O que aconteceu?" (opcional) e abre o chamado na hora, mostrando "Chamado aberto". Voltar a marcar Funciona pergunta "Cancelar o chamado aberto?".
  4. Resultado (só saída) — Liberado / Bloqueado; Liberado fica desabilitado com explicação quando há limpeza "Não" ou chamado aberto; Bloqueado mostra o motivo sugerido editável.
- "Voltar" / "Próxima etapa"; no fim, resumo e "Concluir".
- O checklist em andamento é salvo no próprio aparelho a cada resposta (por quarto e tipo) e retomado ao reabrir o quarto; ao concluir, o rascunho é apagado.
- Sem conexão: o checklist continua sendo preenchido; marcar "Não funciona" mostra "O chamado será aberto ao concluir" e o chamado é criado no envio do checklist. "Concluir" fica desabilitado até a conexão voltar (faixa de conexão já existente).

### 4.2 Recepção — tela Hoje
- Novo bloco **Chamados abertos**: quarto, descrição, observação, quem abriu, há quanto tempo, botão **Resolvido** (abre campo de observação opcional). Após resolver o último chamado de um quarto bloqueado, o item mostra **Liberar quarto**.
- Bloco **Governança agora**: inclui quartos bloqueados com motivo e a quantidade de ocupados ainda não arrumados hoje.
- O contador de atenção do menu soma os chamados abertos.

### 4.3 Mapa e painel da reserva
- Quarto bloqueado continua indisponível para reservas e mostra o motivo no mapa (já existente), agora com o nº de chamados abertos.
- Painel da reserva (aba Resumo): "Última arrumação: hoje às 10:42 por Ana" (ou "Sem arrumação hoje").

## 5. API (servidor)

- `GET /api/checklists/modelos` → modelos ativos com itens ativos (sessão com `quartos.situacao`).
- `POST /api/quartos/:id/checklists` → `{ tipo: "saida" | "diaria", iniciadoEm, respostas: { itemId, simNao?, quantidade?, equipamento?, observacao?, chamadoId? }[], resultado?: "liberado" | "bloqueado", motivo? }`. Valida as regras da seção 3 numa transação; para "Não funciona" sem `chamadoId` (preenchido offline) cria o chamado nesse momento. Erros: `QUARTO_NAO_SUJO`, `QUARTO_NAO_OCUPADO`, `RESPOSTA_FALTANDO`, `LIMPEZA_INCOMPLETA`, `CHAMADO_ABERTO`, `MOTIVO_OBRIGATORIO`. Eventos `governanca.ChecklistConcluido`; auditoria.
- `POST /api/quartos/:id/chamados` → `{ itemId, observacao? }` cria chamado aberto; `POST /api/chamados/:id/cancelar` (quem abriu); `POST /api/chamados/:id/resolver` → `{ observacao? }` devolve `{ podeLiberar }`. Eventos e auditoria.
- `GET /api/chamados?situacao=aberto` para a recepção.
- `GET /api/governanca` ampliado: `tarefa` (`limpeza_saida` | `arrumacao` | null), `arrumadoHojeEm`, `motivoBloqueio`, `chamadosAbertos`.
- Painel do dia: `chamadosAbertos` (lista) e `numeros.ocupadosSemArrumacao`.
- `obterReserva`: `ultimaArrumacao: { em, por } | null`.
- `liberar` passa a verificar chamados abertos.

## 6. Dados (novas tabelas, migrações na faixa `0500_governanca*`)

- `checklist_modelos(id, tipo UNIQUE)` — seeds Saída e Diária.
- `checklist_itens(id, modelo_id, etapa, texto, ordem, ativo)` — seeds da seção 2.1.
- `checklist_execucoes(id, quarto_id, tipo, reserva_id NULL, usuario_id, iniciado_em, concluido_em, resultado NULL, motivo NULL)`.
- `checklist_respostas(execucao_id, item_id, etapa, texto_item, sim_nao NULL, quantidade NULL, equipamento NULL, observacao NULL, chamado_id NULL)`.
- `chamados(id, quarto_id, item_id NULL, descricao, observacao NULL, situacao, aberto_por, aberto_em, encerrado_por NULL, encerrado_em NULL, observacao_encerramento NULL)` — única atualização permitida: a mudança de `aberto` para `resolvido`/`cancelado`.

Execuções e respostas: somente inserção.

## 7. Demonstração

`semearDemonstracao` passa a incluir: um quarto `bloqueado` com motivo "Ar-condicionado não funciona" e um chamado aberto correspondente; um checklist de saída concluído ontem e duas arrumações de hoje (para o mapa e o painel mostrarem dados).

## 8. Testes

- Servidor: cada regra da seção 3 (liberar com/sem limpeza completa e chamados abertos, motivo obrigatório, transição sujo→bloqueado, diária só com hospedada, chamado offline criado no envio, cancelar só por quem abriu, liberar bloqueado com chamado aberto recusado, `podeLiberar`).
- Interface: fluxo por etapas, botões de contagem e "+", abertura/cancelamento de chamado, Liberado desabilitado com explicação, motivo sugerido, rascunho salvo e retomado, bloco Chamados abertos com Resolvido → Liberar quarto.
- Ponta a ponta (navegador): camareira faz limpeza de saída marcando o ar-condicionado com defeito e bloqueia; recepção vê o chamado, resolve e libera; o quarto fica livre no mapa.

## 9. Fora de escopo

Tela de configuração dos modelos (B2), perfil de manutenção, custos por chamado, relatórios e métricas (os dados ficam prontos para eles), fotos no checklist, controle de lavanderia/estoque de enxoval.
