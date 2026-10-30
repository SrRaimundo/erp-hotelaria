# ERP de Hotelaria — Plano B2a: Retaguarda (assistente, pousada, quartos, pessoas, produtos, checklists)

**Data:** 2026-10-29
**Status:** em revisão
**Base:** specs `2026-10-22-nucleo-hospedagem-design.md`, `2026-10-23-plano-b1-interface-design.md`, `2026-10-24-governanca-checklist-design.md`. As telas de tarifas avançadas (temporadas, dias da semana, canais, ocupação, crianças, pacotes, restrições, simulador) ficam para o **B2b**.

## 1. Objetivo

Permitir que o administrador implante e mantenha uma pousada pela interface, sem script de demonstração nem chamadas à API: um **assistente de primeira configuração** que deixa a pousada vendendo em poucos minutos, e as telas de cadastro e configuração do dia a dia administrativo.

**Critérios de sucesso:**
- Uma pousada nova (base vazia) chega à primeira reserva usando só o assistente.
- Todo cadastro pode ser criado, editado e desativado/reativado pela interface; nada que já foi usado é apagado.
- O administrador cria perfis próprios e escolhe as permissões de cada um, sem conseguir travar o sistema (sempre há um administrador ativo capaz de configurar).

## 2. Regras comuns

- **Desativar em vez de apagar:** quartos, categorias, produtos, usuários, perfis personalizados sem usuários (estes podem ser excluídos) e itens de checklist. Itens desativados somem das listas de uso (nova reserva, mapa, checklist, lançamentos, login) e continuam no histórico; podem ser reativados.
- **Auditoria:** toda criação, edição, desativação e reativação é auditada (quem, quando, o quê).
- **Permissão:** a área Configurações exige `config.gerenciar` (assistente, pousada, usuários, perfis, checklists) ou `cadastros.gerenciar` (categorias, quartos, produtos). O item de menu aparece se o usuário tiver qualquer uma delas, e cada tela só aparece com a sua.
- **Mensagens:** erros de regra em português, junto da ação, como no restante do sistema.

## 3. Navegação

- Item **Configurações** no menu lateral, com submenu: **Pousada**, **Categorias e quartos**, **Usuários**, **Perfis**, **Produtos**, **Checklists**, **Primeira configuração**.
- Padrão de tela: lista (com filtro "mostrar desativados") + botão **+ Novo** + edição no painel lateral deslizante (o mesmo componente da reserva), sem sair da lista.

## 4. Assistente de primeira configuração

- Abre automaticamente para quem tem `config.gerenciar`, após a troca de senha obrigatória, enquanto a pousada **não tem nenhum quarto ativo**. Pode ser reaberto pelo submenu.
- Passos (voltar/avançar; cada passo grava ao avançar; ao reabrir, retoma no primeiro passo incompleto):
  1. **Pousada:** razão social, CNPJ, endereço, horário de check-in e de check-out.
  2. **Categorias e quartos:** para cada categoria — nome, máximo de adultos e de crianças, preço da diária para 1, 2 e 3 adultos e adulto extra, e uma faixa de numeração ("de 101 a 106", com bloco opcional). Botão "+ Outra categoria". Cria categorias, tabela base e quartos de uma vez; numeração duplicada é recusada antes de gravar, mostrando os números em conflito.
  3. **Equipe:** usuários com nome, login, perfil (Recepção ou Governança por padrão; qualquer perfil existente) e senha inicial; todos com troca obrigatória no primeiro acesso. Passo opcional ("Pular").
  4. **Pronto:** resumo (N categorias, N quartos, N usuários) e atalhos "Ir para o mapa" e "Ajustar regras da pousada".
- O canal Balcão já existe (seed); o assistente não pede canais.

## 5. Telas

### 5.1 Pousada
Tela única em seções:
- **Dados:** razão social, CNPJ, endereço, fuso horário.
- **Horários:** check-in, check-out, virada do dia hoteleiro.
- **Regras:** sinal (exigir; percentual ou primeira diária; percentual; prazo em horas; tolerância em horas), early check-in e late check-out (fixo em reais ou percentual da diária), idade a partir da qual conta como adulto, limite de crianças grátis por quarto, arredondamento (nenhum / real inteiro), "Camareira lança frigobar".
- Botão "Salvar" por seção; usa `PUT /api/config` existente.

### 5.2 Categorias e quartos
- **Categorias:** nome, capacidade de adultos e crianças, comodidades (lista livre), preço base (1, 2, 3 adultos, adulto extra; piso e teto opcionais). Desativar exige nenhum quarto ativo na categoria (`CATEGORIA_COM_QUARTOS`).
- **Quartos:** número, categoria, bloco. Desativar exige nenhuma reserva ativa (`pre_reserva`, `confirmada`, `hospedada`) com o quarto atribuído e saída a partir de hoje (`QUARTO_COM_RESERVAS`, com os códigos das reservas). Quarto ocupado não pode ser desativado. Mudar a categoria não altera o preço de reservas existentes. "Criar vários": faixa de numeração como no assistente.
- Quarto desativado sai do mapa, das sugestões de check-in, da disponibilidade e da governança.

### 5.3 Usuários
- Lista: nome, login, perfil, situação, último acesso.
- Criar (nome, login, perfil, senha inicial — troca obrigatória), editar nome e perfil, desativar, reativar, **redefinir senha** (gera senha temporária de 8 caracteres mostrada uma única vez, com troca obrigatória).
- Desativar encerra todas as sessões do usuário na hora; usuário desativado não entra (`USUARIO_DESATIVADO`).
- Ninguém desativa a si mesmo nem muda o próprio perfil (`OPERACAO_SOBRE_SI`).
- Sempre deve restar ao menos um usuário **ativo** cujo perfil tenha `config.gerenciar` (`ULTIMO_ADMINISTRADOR`).

### 5.4 Perfis
- Lista: os três padrão (Administrador, Recepção, Governança) e os personalizados, com nº de usuários.
- **Criar:** nome de exibição + "copiar permissões de" (um perfil existente). O identificador interno é gerado a partir do nome e não muda depois.
- **Editar:** nome de exibição, limite de desconto (%) e permissões em lista de marcação, cada uma com descrição em português:

| Permissão | Descrição |
|---|---|
| `reservas.gerenciar` | Criar, alterar e cancelar reservas; ver hóspedes, mapa e painel |
| `hospedagem.checkin` | Fazer check-in |
| `hospedagem.checkout` | Fazer check-out |
| `conta.lancar` | Lançar extras, frigobar e estornos na conta do hóspede |
| `caixa.operar` | Abrir e fechar caixa e receber pagamentos |
| `quartos.situacao` | Preencher checklists de governança |
| `quartos.manutencao` | Resolver chamados, bloquear, liberar e pôr quartos em manutenção |
| `cadastros.gerenciar` | Cadastrar categorias, quartos e produtos |
| `tarifas.gerenciar` | Configurar tarifas |
| `config.gerenciar` | Configurar a pousada, usuários, perfis e checklists |
| `supervisor` | Autorizar ações sensíveis com a senha de supervisor |

- **Excluir:** só perfis personalizados sem usuários (`PERFIL_COM_USUARIOS`). Perfis padrão não são excluídos.
- O perfil **Administrador** não pode perder `config.gerenciar` (`PERFIL_ADMIN_PROTEGIDO`); qualquer edição que deixaria o sistema sem administrador ativo é recusada (`ULTIMO_ADMINISTRADOR`).
- Mudança de permissões vale para o próximo login dos usuários do perfil e para sessões abertas na próxima requisição (a sessão relê as permissões do perfil).

### 5.5 Produtos
- Lista com filtro por setor e "mostrar desativados": código, nome, preço, unidade, setores.
- Criar/editar: código (único), nome, preço (R$), unidade, tipo (produto/serviço) e setores de venda (Recepção, Frigobar, Bar, Restaurante — ao menos um). Produtos internos `EARLY_CHECKIN`/`LATE_CHECKOUT` não aparecem na lista (são do setor Hospedagem e geridos pelas regras da pousada).
- Desativar remove o produto das listas de lançamento, do frigobar e do checklist; lançamentos antigos ficam como estão.

### 5.6 Checklists
- Abas **Saída** e **Diária**; em cada uma, as etapas Limpeza, Enxoval, Equipamentos e Controles com seus itens.
- Incluir item (texto, etapa), renomear, reordenar dentro da etapa (↑ ↓), desativar e reativar. Uma etapa pode ficar vazia (o checklist a pula).
- Renomear não altera checklists já feitos (eles guardam cópia do texto).
- Um checklist em andamento no celular que usa um item desativado: ao concluir, o servidor ignora respostas de itens desativados e não exige itens criados depois do início (o rascunho guarda os ids que exibiu).

## 6. Servidor — o que muda

- **Categorias:** `PUT /api/categorias/:id` (nome, capacidades, comodidades), `POST /api/categorias/:id/desativar|reativar`; `categorias.ativa`.
- **Quartos:** `PUT /api/quartos/:id` (número, categoria, bloco), `POST /api/quartos/:id/desativar|reativar`, `POST /api/quartos/lote` (faixa); `quartos.ativo`; disponibilidade, mapa, governança, sugestões e ocupação ignoram inativos.
- **Produtos:** `PUT /api/produtos/:id`, `POST /api/produtos/:id/desativar|reativar`; `produtos.ativo`; listas de uso ignoram inativos.
- **Usuários:** `GET /api/usuarios`, `PUT /api/usuarios/:id`, `POST /api/usuarios/:id/desativar|reativar|redefinir-senha`; `usuarios.ativo`, `usuarios.ultimo_acesso`; login recusa desativados; desativar apaga as sessões.
- **Perfis:** `GET /api/perfis`, `POST /api/perfis`, `PUT /api/perfis/:nome`, `DELETE /api/perfis/:nome`; coluna `perfis.rotulo` (nome de exibição) e `perfis.padrao`; `GET /api/permissoes` (lista com descrições). A sessão passa a reler permissões do perfil a cada requisição.
- **Checklists:** `GET /api/checklists/itens?tipo=` (inclui inativos), `POST /api/checklists/itens`, `PUT /api/checklists/itens/:id` (texto, ativo), `POST /api/checklists/itens/:id/mover` (`{ direcao: "acima" | "abaixo" }`); conclusão tolera itens desativados após o início (`itensExibidos` no corpo).
- **Assistente:** `GET /api/assistente` (passos concluídos: pousada se razão social preenchida; quartos se há quarto ativo; equipe se há usuário além do admin ou se o passo foi pulado — guardado na configuração `assistenteEquipePulado`) e `POST /api/assistente/quartos` (`{ categorias: { nome, maxAdultos, maxCriancas, porAdultos, adultoExtra, de, ate, bloco? }[] }` numa transação).
- Migrações na faixa `0600_retaguarda*`; colunas novas com padrão "ativo".

## 7. Testes

- Servidor: desativar categoria com quartos, quarto com reserva futura, quarto ocupado; inativos fora da disponibilidade/mapa/governança; último administrador (desativar, mudar perfil, editar perfil); `OPERACAO_SOBRE_SI`; sessões encerradas ao desativar; perfil com usuários não excluído; admin protegido; permissões relidas na sessão; produto inativo fora das listas; reordenar itens; conclusão de checklist com item desativado durante o preenchimento; assistente cria categorias, tabela base e quartos atomicamente e recusa numeração duplicada.
- Interface: cada tela (lista, novo, editar, desativar/reativar, mensagens de erro), assistente (avança, grava, retoma, pula equipe), menu só com permissão.
- Ponta a ponta (navegador): base vazia → login admin → troca de senha → assistente completo → nova reserva no mapa → login da recepção criada no assistente.

## 8. Fora de escopo (B2a)

Telas de tarifas avançadas e simulador (B2b), cadastro de canais (B2b), cadastro de setores próprios e preço por setor, logo da pousada, importação por planilha, métricas e relatórios.
