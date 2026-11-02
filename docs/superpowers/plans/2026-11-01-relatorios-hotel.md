# Plano — Relatórios do Hotel (primeira entrega)

Spec: `docs/superpowers/specs/2026-11-01-relatorios-hotel-design.md`. Execução por subagentes: um implementador e uma revisão por task; revisão final do conjunto.

Regras: TDD; sem migrações; dinheiro em centavos; "hoje" pelo dia hoteleiro; não usar a porta 8080; preservar finais de linha.

### Task 1: Servidor — base e listas de reservas
- Criar `apps/server/src/relatorios/{modelo,rotas,check-in,check-out,na-casa,cafe}.ts`, registrar as rotas em `http/app.ts`.
- `Relatorio`, `GET /api/relatorios/:id`, erros da spec §3.
- Testes em `apps/server/test/relatorios/reservas.test.ts`: limites de data do café (`chegada < data <= saída`), cancelados e no-show de fora, sem quarto "a definir", 403, 404, 422.
- Commit: `feat(server): relatórios de check-in, check-out, na casa e café`

### Task 2: Servidor — limpeza, conta, hóspedes e caixa
- Criar `relatorios/{limpeza,conta,hospedes,caixa}.ts` reaproveitando `listaGovernanca`, `extrato`, `saldo` e os dados de `nucleo/caixa.ts`.
- `GET /api/relatorios/caixa/turnos`. Se o turno fechado não guardar esperado e contado por forma, recalcular dos movimentos e registrar isso no relatório da task.
- Auditar a geração de `hospedes`. Caixa: só os próprios turnos, exceto `config.gerenciar` ou `supervisor`.
- Testes em `test/relatorios/operacao.test.ts`.
- Commit: `feat(server): relatórios de limpeza, conta, hóspedes e caixa`

### Task 3: Web — catálogo, visor e impressão
- Criar `apps/web/src/telas/relatorios/{TelaRelatorios,TelaRelatorio,VisorRelatorio,FiltrosRelatorio,formatar,catalogo}.ts(x)`, `relatorios.css` com `@media print`.
- Substituir o `TelaEmBreve` de `/relatorios` em `TELAS_PRONTAS`; adicionar `/relatorios/:id`.
- Botões "Imprimir conta" na reserva e "Relatório" no caixa.
- Commit: `feat(web): catálogo e visor de relatórios com impressão`

### Task 4: Web — PDF e compartilhamento
- Adicionar `jspdf` e `jspdf-autotable`, carregados só por `import()`; conferir no build que ficam em chunk separado.
- `gerarPdf(relatorio, cabecalho)`, botões Exportar PDF e Compartilhar, com a regra de `canShare`.
- Commit: `feat(web): exportar e compartilhar relatórios em PDF`

### Task 5: Ponta a ponta
- `apps/web/e2e/relatorios.spec.ts`: check-in → trocar data → baixar PDF (`%PDF`); café; conta a partir da reserva.
- Rodar e2e, suítes e typechecks.
- Commit: `test(e2e): relatórios do hotel`
