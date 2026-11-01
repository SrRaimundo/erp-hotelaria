# Plano B2a — decisões e pendências

## Decisões tomadas na execução
- R1: `ExigePermissao` aceita `algumaDe` (qualquer uma das permissões).
- R2: a regra do último administrador fica em um só lugar (`exigirAdministradorRestante`).
- R3: número de quarto é único entre todos os quartos, ativos e inativos.
- R4: criar usuário exige `config.gerenciar`.
- R5: listas de categorias, quartos e produtos devolvem `ativo`.
- R6: preço base só aparece com `tarifas.gerenciar`.
- R7: `GET /api/sessoes/atual` e releitura da sessão na web.
- R8: `/configuracoes` leva ao assistente enquanto não há quartos.
- R9: redefinir a própria senha é recusado (`OPERACAO_SOBRE_SI`).
- R10: o assistente abre após qualquer login de quem tem `config.gerenciar`, enquanto não há quartos, uma vez por sessão.
- Categoria duplicada no assistente considera também as desativadas.

## Pendências aceitas
- M4: chamados de quarto inativo seguem na lista.
- M5: desativar o último quarto de uma categoria não olha reservas sem quarto atribuído. Aguarda decisão do dono.
- M6: `itensExibidos` vem do cliente; sem ganho de privilégio.
- M8: `trocar_senha` é exigido só pela web, não pela API.
- M12: produtos internos editáveis por chamada direta à API.
- M13: quarto inativo aceita bloqueio, chamado e checklist por chamada direta à API.
- M14: quem tem `config.gerenciar` pode editar o próprio perfil; essa permissão já equivale a administrador.
- Governança (R13 do plano anterior): chamado desvinculado offline segue aberto no servidor.
