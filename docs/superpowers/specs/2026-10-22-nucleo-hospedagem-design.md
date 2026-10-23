# ERP de Hotelaria — Subprojeto 1: Arquitetura, Núcleo e Hospedagem

**Data:** 2026-10-22
**Status:** em revisão

## 1. Contexto e objetivo

Produto SaaS para vender a **vários hotéis e pequenas pousadas** no Brasil. O dono do produto conhece o domínio por experiência em empresa de software do setor; o código é escrito pelo Claude, que também escolhe a tecnologia buscando simplicidade de manutenção.

**Diferencial:** barato, poderoso e **leve** para o parque de hardware enxuto desses clientes, com foco em **dinamismo e facilidade** de uso (poucos cliques, telas autoexplicativas, operadores nem sempre experientes em tecnologia).

**Critérios de sucesso deste subprojeto:**
- Uma pousada consegue operar reservas, check-in e check-out completos **sem internet**, com vários dispositivos na rede interna.
- Requisito mínimo de hardware do servidor local: **Windows 10, 4 GB de RAM**. Abaixo disso, não suportado.
- Check-in de hóspede recorrente em menos de 1 minuto.
- Nenhum lançamento perdido ou duplicado na sincronização com a nuvem.

### Decomposição do produto

O ERP completo é dividido em subprojetos, cada um com seu próprio ciclo de especificação, plano e implementação:

| # | Subprojeto | Status |
|---|---|---|
| 1 | **Arquitetura + Núcleo + Tarifas + Hospedagem** | este documento |
| 2 | Consumo e extras (lançamentos na conta do hóspede, frigobar, serviços) | futuro |
| 3 | Bar e Restaurante (comandas, mesas, cardápio, cozinha) | futuro |
| 4 | Estoque | futuro |
| 5 | Financeiro (contas a pagar e a receber, caixa consolidado) | futuro |
| 6 | Agente de reservas (IA) e reservas pela nuvem | futuro |
| 7 | Integrações (OTAs, fiscal, TEF) | futuro |

## 2. Arquitetura

### 2.1 Princípio central

**A pousada manda na operação.** O servidor local é a fonte da verdade para quartos, reservas, contas e caixa daquela pousada. A nuvem é réplica, backup e canal de acesso remoto.

### 2.2 Componentes

```
[Tablet] [Celular] [PC recepção]          ← navegador (PWA)
        \     |      /
      rede interna (Wi-Fi/cabo)
              |
   [Servidor local — serviço Windows]
     API + interface web + SQLite + sincronizador + impressão
              |
       (internet, quando houver)
              |
   [Nuvem — mesmo código, modo multi-hotel, MySQL]
```

- **Servidor local:** um único programa instalado como **serviço do Windows**, que inicia junto com o PC. Contém a API com todas as regras de negócio, serve a interface web, guarda os dados em **SQLite** embutido, sincroniza com a nuvem e imprime. Os dispositivos acessam por um endereço da rede interna (ex.: `http://pousada.local`).
- **Nuvem:** o mesmo código em modo multi-hotel, com **MySQL** (escolhido por ser familiar ao dono do produto, facilitando suporte e consultas).
- **Clientes:** qualquer navegador moderno. A interface é instalável como app (PWA) em tablets e celulares.

### 2.3 Tecnologia

- **TypeScript** em todo o sistema: servidor em **Node.js**, interface em **React**.
- **SQLite** no servidor local (sem instalação de banco pelo cliente), **MySQL** na nuvem. A camada de acesso a dados abstrai os dois bancos.
- **Instalador Windows** que registra o serviço e configura o endereço na rede interna.

### 2.4 Monolito modular

Um único programa, dividido em módulos isolados: **Núcleo, Tarifas, Hospedagem** (este subprojeto) e, no futuro, Consumo, Bar e Restaurante, Estoque e Financeiro.

- Cada módulo é dono das suas tabelas. Outro módulo não lê nem grava nelas diretamente.
- Os módulos se comunicam por **interfaces públicas** (funções de serviço) e **eventos de domínio** (ex.: `ContaHospede.LancamentoCriado`).
- Cada módulo pode ser construído e testado isoladamente.

### 2.5 Papel da nuvem neste subprojeto

Para manter o escopo enxuto, nesta versão a nuvem:
- **recebe** os eventos de cada pousada (backup contínuo);
- oferece ao dono um **painel remoto somente leitura** (ocupação, chegadas e saídas, reservas, contas abertas);
- **não cria nem altera** dados da pousada.

O provisionamento de novos hotéis na nuvem é manual (feito pelo dono do produto). Cobrança e assinatura do SaaS ficam fora de escopo.

### 2.6 Sincronização

- Toda alteração gera um **evento** com identificador único global (UUID) e número sequencial local.
- Eventos ficam numa fila local (*outbox*). Quando há internet, o sincronizador envia em ordem e a nuvem confirma o recebimento. **Reenviar um evento já recebido não tem efeito** (idempotência pelo UUID).
- Retentativa automática com intervalo crescente.
- **Lançamentos financeiros nunca são editados nem apagados:** a correção é sempre por **estorno** (novo lançamento de sinal contrário).
- Cada instalação se autentica na nuvem com um **token de instalação** emitido no provisionamento.

**Regra registrada para o futuro (subprojeto 6):** quando a nuvem passar a criar reservas, ela reserva apenas por **categoria** de quarto; o número do quarto é sempre atribuído na pousada. Se a sincronização revelar overbooking, o sistema **alerta** a recepção e nunca cancela nenhuma reserva sozinho.

## 3. Núcleo

### 3.1 Cadastros

- **Pousada:** razão social, CNPJ, endereço, logo, horários padrão de check-in e check-out, fuso horário. Moeda: somente real (BRL).
- **Categorias de quarto:** nome, capacidade máxima de adultos e de crianças, comodidades.
- **Quartos:** número, categoria, andar ou bloco e situação: `livre`, `ocupado`, `sujo`, `em_manutencao`, `bloqueado`.
- **Hóspedes:** nome, CPF ou passaporte, data de nascimento, contato, endereço, nacionalidade, histórico de estadias, observações e preferências. Os campos cobrem os dados exigidos pela **FNRH**.
- **Produtos e serviços:** cadastro único (nome, código, preço, unidade, grupo). Neste subprojeto é usado para extras de hospedagem (early check-in, late check-out, cama extra). Os subprojetos futuros reutilizam o mesmo cadastro.
- **Formas de pagamento:** dinheiro, PIX, cartão de débito, cartão de crédito, faturado. Configuráveis (ativar e desativar).

### 3.2 Usuários e perfis

Perfis prontos, com permissões ajustáveis por pousada:

| Perfil | Acesso |
|---|---|
| Administrador/Dono | tudo, inclusive painel remoto e configurações |
| Recepção | reservas, check-in e check-out, contas de hóspede, caixa próprio |
| Governança | somente situação dos quartos (limpo/sujo/manutenção), pelo celular |

O perfil Bar/Restaurante será criado no subprojeto 3.

**Ações sensíveis** exigem **senha de supervisor** (um usuário com essa permissão) e um **motivo**: estorno, cancelamento manual de reserva, desconto acima do limite do perfil, prorrogação de prazo de sinal, alteração de tarifa congelada.

**Auditoria:** toda ação registra usuário (ou `Sistema`, para ações automáticas), data e hora, dispositivo e, quando aplicável, motivo e supervisor que autorizou.

### 3.3 Turnos de caixa

- Cada operador **abre** o caixa (informando o valor inicial em dinheiro) e **fecha** (informando os valores contados por forma de pagamento).
- O fechamento mostra a diferença entre o esperado e o informado.
- Não é possível receber pagamento sem caixa aberto.
- A consolidação dos caixas no financeiro fica para o subprojeto 5. Neste subprojeto existe o relatório de fechamento de cada turno.

## 4. Motor de tarifas

### 4.1 Cálculo de uma diária

O valor de cada noite é calculado sempre nesta ordem:

1. **Tarifa base:** por categoria e por ocupação (1, 2, 3 adultos e adicional por adulto extra), mais o valor de cada **faixa de idade de criança** (ver 4.2).
2. **Temporada:** calendário de períodos nomeados (Alta, Baixa, Feriado...). Cada período define **ou** uma tabela base própria **ou** um percentual sobre a tabela padrão. Se houver sobreposição de períodos, vale o de **maior prioridade** (definida no cadastro).
3. **Dia da semana:** percentual opcional por dia (ex.: sexta e sábado +15%).
4. **Canal (plano tarifário):** `Balcão` é a referência. Os demais canais (ex.: `Site`, `Agência`) são definidos como percentual sobre o Balcão. Alterar o Balcão altera os derivados.
5. **Dinâmica por ocupação:** faixas de ocupação **da categoria na data** com percentual de ajuste (ex.: acima de 70%, +10%; acima de 90%, +25%). Calculada no momento da cotação. Cada categoria tem **piso e teto** de valor que o resultado nunca ultrapassa.
6. **Pacote:** se a estadia se enquadra num pacote ativo (datas, categoria, mínimo de noites), o preço fechado do pacote **substitui** o resultado das camadas 1 a 5 para as noites cobertas.

Os percentuais das camadas 2 a 5 são aplicados em sequência, sobre o resultado da camada anterior. O valor final é arredondado a duas casas decimais. O arredondamento comercial (ex.: para o real inteiro) é configurável por pousada e desligado por padrão.

### 4.2 Crianças

- Faixas de idade configuráveis, cada uma com um valor: **grátis**, **percentual do adicional de adulto** ou **valor fixo**. Ex.: 0 a 5 anos grátis; 6 a 11 anos 50% do adicional; 12 anos ou mais conta como adulto.
- **Limite de crianças grátis por quarto** (ex.: 1). As crianças que excederem o limite são cobradas pela **primeira faixa pagante**.
- A idade considerada é a da **data de chegada**.

### 4.3 Restrições por data

Por categoria e data: **mínimo de noites**, **fechado para chegada**, **fechado para saída**, **fechado para venda**. A recepção pode ultrapassar uma restrição com senha de supervisor.

### 4.4 Regras de confiança

- **O preço congela na reserva.** Mudanças posteriores em regras ou ocupação não alteram reservas existentes. Alterar o preço congelado é ação sensível.
- **Alterar a estadia** (datas, categoria, número de pessoas) recalcula **apenas as noites afetadas** com as regras atuais e exige confirmação, mostrando o valor antigo e o novo.
- **Detalhamento:** toda diária guarda e exibe a decomposição do cálculo (ex.: "Base R$ 300 → Alta +20% → Sábado +15% → Ocupação 85% +10% = R$ 455,40").
- **Desconto manual:** permitido até o limite percentual do perfil. Acima, senha de supervisor.
- **Simulador:** tela onde o administrador informa categoria, datas, pessoas e canal e vê o resultado detalhado, sem criar reserva.

## 5. Hospedagem

### 5.1 Ciclo de vida da reserva

Estados: `pre_reserva`, `confirmada`, `hospedada`, `finalizada`, `cancelada`, `no_show`.

```
pre_reserva ──(sinal pago)──► confirmada ──(check-in)──► hospedada ──(check-out)──► finalizada
     │                            │
     │                            └──(não compareceu)──► no_show
     └──(cancelamento manual ou automático)──► cancelada
```

- Uma reserva sem exigência de sinal (configuração da pousada ou do canal) nasce `confirmada`.
- `no_show` é marcado manualmente pela recepção. O painel do dia lista as reservas confirmadas com chegada vencida para lembrar a recepção.
- Cancelamento manual e marcação de no-show exigem motivo.

### 5.2 Sinal e cancelamento automático

- **Sinal configurável** por pousada: percentual da reserva **ou** valor da primeira diária. **Prazo para pagamento** configurável em horas a partir da criação.
- Quando o prazo vence, o sistema **avisa** a recepção (painel do dia e notificação na tela).
- A recepção pode:
  - **registrar o pagamento:** a reserva passa a `confirmada`;
  - **prorrogar o prazo:** ação sensível, com motivo; o ciclo recomeça com o novo prazo;
  - **cancelar manualmente.**
- Se nada for feito até o fim da **tolerância após o aviso** (configurável em horas), o **servidor local cancela automaticamente** a reserva, libera o quarto no mapa e registra na auditoria como ação do `Sistema`, com o motivo "sinal não pago".
- **Pagamento parcial** (abaixo do valor do sinal) **impede o cancelamento automático**: há dinheiro em jogo, então a reserva fica em alerta até a recepção decidir.
- Se a sincronização trouxer um pagamento para uma reserva já cancelada, o sistema **alerta** a recepção para reativar ou devolver o valor.

### 5.3 Reservas

- Campos: titular (hóspede), categoria, quarto (opcional até o check-in), datas de chegada e saída, adultos, crianças com idades, canal, observações.
- **Grupos:** várias reservas (quartos) ligadas a um titular de grupo. Cobrança configurável por grupo: **conta única** do titular ou **contas separadas** por quarto.
- A disponibilidade considera reservas `pre_reserva`, `confirmada` e `hospedada` e quartos `em_manutencao` ou `bloqueado` no período.

### 5.4 Mapa de ocupação

Tela principal da recepção: uma grade com **quartos nas linhas** (agrupados por categoria) e **dias nas colunas**.

- Barras coloridas por estado da reserva, com o nome do titular.
- **Arrastar** a barra troca o quarto ou as datas. **Esticar** a ponta altera a saída. Ambos recalculam conforme 4.4 e pedem confirmação.
- **Clicar em espaço vazio** abre nova reserva com quarto e data preenchidos.
- Indicador da situação de cada quarto (livre, sujo, manutenção) no dia atual.
- Navegação por período (semana, quinzena, mês) e filtro por categoria.

### 5.5 Check-in

- Busca da reserva por nome, CPF ou número. Hóspede recorrente traz os dados já preenchidos.
- Preenchimento ou confirmação dos dados da FNRH do titular e dos acompanhantes.
- Atribuição de quarto: o sistema **sugere apenas quartos limpos** da categoria reservada. Escolher outra categoria (upgrade) é permitido e registrado, sem alterar o preço congelado salvo decisão explícita.
- Ao concluir: a reserva vira `hospedada`, o quarto vira `ocupado`, a **conta do hóspede** é aberta e a **ficha de check-in (FNRH) é impressa automaticamente** em A4 para assinatura (exigência local).
- Early check-in: cobrança conforme regra configurada (valor fixo ou percentual da diária), lançada como extra.

### 5.6 Conta do hóspede

- Uma conta por reserva (ou uma por grupo, conforme 5.3).
- **Diárias:** lançadas automaticamente a cada noite, num horário configurável de virada do dia hoteleiro (padrão 04:00), usando o valor congelado. Assim o saldo da conta reflete o real a qualquer momento.
- **Extras:** lançamento manual de produtos ou serviços do cadastro (neste subprojeto, extras da hospedagem; o subprojeto 2 amplia).
- **Pagamentos:** sinal e pagamentos parciais durante a estadia, sempre num caixa aberto.
- **Estorno** de lançamento ou pagamento: ação sensível, com motivo.
- A interface pública da conta (`lançar`, `estornar`, `consultar saldo`) é o ponto que os subprojetos 2 e 3 vão usar.

### 5.7 Check-out

- Conta consolidada, com lançamentos detalhados por origem e data.
- Late check-out: cobrança conforme regra configurada.
- **Pagamento dividido** em várias formas e/ou entre hóspedes.
- **Faturado:** transfere o saldo para uma empresa ou responsável, gerando um registro de valor a receber (consumido pelo subprojeto 5).
- O check-out só conclui com **saldo zero** (pago, faturado ou estornado).
- Ao concluir: a reserva vira `finalizada`, o quarto vira `sujo` e aparece na lista da governança.

### 5.8 Governança

Tela para celular com a lista de quartos e situação. A camareira marca `sujo → livre` ao terminar a limpeza. Manutenção e bloqueio exigem perfil de Recepção ou Administrador e motivo.

## 6. Experiência de uso

- **Busca universal** (`Ctrl+K`): um campo que encontra quarto, hóspede ou reserva e oferece ações rápidas.
- **Teclado primeiro** na recepção: atalhos para nova reserva, check-in, check-out e lançar extra.
- **Toque primeiro** em celular e tablet, com botões grandes.
- **Painel do dia** como tela inicial: chegadas, saídas, hospedados, quartos sujos, sinais vencendo ou vencidos, alertas.
- **Indicador de conexão** sempre visível: "Online" ou "Offline – N ações aguardando envio". A operação é idêntica nos dois casos.
- Nenhuma exclusão sem confirmação. Correções por estorno, com histórico.

## 7. Impressão

- O **servidor local** imprime direto nas impressoras instaladas no Windows, sem diálogo do navegador. Uma ação feita no tablet imprime na impressora configurada para aquele tipo de documento.
- **A4:** ficha de check-in/FNRH (automática no check-in), extrato completo da conta.
- **Térmica 80 mm (ESC/POS):** recibo de pagamento, extrato resumido.
- Todo documento também pode ser gerado em **PDF** para envio por WhatsApp ou e-mail (o envio em si é manual neste subprojeto: o sistema gera o arquivo).
- Falha de impressão gera aviso na tela com a opção de reimprimir.

## 8. Robustez e tratamento de erros

- **SQLite em modo WAL** com transações em toda operação: uma queda de energia não corrompe o banco nem deixa operação pela metade.
- O serviço reinicia automaticamente com o Windows e após falha.
- **Backup local** automático diário, com retenção de 7 dias, além da réplica contínua na nuvem.
- **Diagnóstico de sincronização:** tela com eventos pendentes, último envio com sucesso e último erro.
- **Restauração:** reinstalar o servidor local a partir da réplica da nuvem (procedimento de suporte).
- Erros de validação aparecem na tela em linguagem simples, dizendo o que corrigir.

## 9. Testes

Testes automatizados obrigatórios nas áreas onde um erro vira prejuízo:
- **Motor de tarifas:** cada camada isolada, combinações, crianças e limite de gratuidade, piso e teto, pacotes, congelamento e recálculo parcial.
- **Ciclo da reserva:** todas as transições válidas e inválidas, sinal, prorrogação, cancelamento automático e bloqueio por pagamento parcial.
- **Conta do hóspede:** lançamento noturno de diárias, estornos, pagamento dividido, saldo zero no check-out.
- **Sincronização:** idempotência (reenvio), ordem, retentativa.
- **Pousada simulada:** teste de ponta a ponta que opera com internet, corta a conexão, continua operando, religa e confere que a nuvem ficou idêntica ao local.

## 10. Fora de escopo deste subprojeto

Consumo amplo (frigobar, lavanderia), bar e restaurante, estoque, financeiro (contas a pagar e a receber), agente de reservas, reservas criadas pela nuvem, integrações (OTAs, emissão fiscal, TEF), envio automático por WhatsApp ou e-mail, cobrança da assinatura SaaS, portal do hóspede.
