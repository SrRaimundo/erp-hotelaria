import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { novoId } from "../shared/ids.js";

export type Centavos = number;
export type Turno = { id: string; usuarioId: string; abertoEm: string; valorInicial: Centavos; fechadoEm: string | null };
export type RelatorioTurno = { porForma: { forma: string; esperado: Centavos; contado: Centavos; diferenca: Centavos }[] };

function paraTurno(l: any): Turno {
  return { id: l.id, usuarioId: l.usuario_id, abertoEm: l.aberto_em, valorInicial: l.valor_inicial, fechadoEm: l.fechado_em };
}

export async function turnoAberto(ctx: Contexto, usuarioId: string): Promise<Turno | null> {
  const l = await ctx.db
    .selectFrom("turnos_caixa")
    .selectAll()
    .where("usuario_id", "=", usuarioId)
    .where("fechado_em", "is", null)
    .executeTakeFirst();
  return l ? paraTurno(l) : null;
}

/** Roda na transação do chamador (ex.: registro de pagamento). */
export async function exigirCaixaAberto(tx: Contexto, usuarioId: string): Promise<Turno> {
  const t = await turnoAberto(tx, usuarioId);
  if (!t) throw new ErroDominio("CAIXA_FECHADO", "Não há caixa aberto para este usuário. Abra o caixa antes de continuar.");
  return t;
}

export async function registrarMovimento(
  tx: Contexto,
  turnoId: string,
  m: { formaCodigo: string; valor: Centavos; origemTipo: string; origemId: string },
): Promise<void> {
  await tx.db
    .insertInto("movimentos_caixa")
    .values({
      id: novoId(),
      turno_id: turnoId,
      forma_codigo: m.formaCodigo,
      valor: m.valor,
      origem_tipo: m.origemTipo,
      origem_id: m.origemId,
      instante: tx.relogio.agora().toISOString(),
    })
    .execute();
}

export type ResumoCaixa = {
  turno: Turno;
  movimentos: { forma: string; valor: Centavos; origemTipo: string; instante: string }[];
  esperadoPorForma: Record<string, Centavos>;
};

/** Turno aberto do usuário com seus movimentos e o valor esperado por forma (dinheiro inclui o valor inicial). */
export async function resumoCaixa(ctx: Contexto, usuarioId: string): Promise<ResumoCaixa | null> {
  const turno = await turnoAberto(ctx, usuarioId);
  if (!turno) return null;
  const ls = await ctx.db
    .selectFrom("movimentos_caixa")
    .select(["forma_codigo", "valor", "origem_tipo", "instante"])
    .where("turno_id", "=", turno.id)
    .orderBy("instante")
    .orderBy("id")
    .execute();
  const esperadoPorForma: Record<string, Centavos> = { dinheiro: turno.valorInicial };
  for (const m of ls) esperadoPorForma[m.forma_codigo] = (esperadoPorForma[m.forma_codigo] ?? 0) + m.valor;
  return {
    turno,
    movimentos: ls.map((m) => ({ forma: m.forma_codigo, valor: m.valor, origemTipo: m.origem_tipo, instante: m.instante })),
    esperadoPorForma,
  };
}

export async function abrirCaixa(ctx: Contexto, usuarioId: string, valorInicial: Centavos): Promise<Turno> {
  return emTransacao(ctx, async (tx) => {
    if (await turnoAberto(tx, usuarioId)) {
      throw new ErroDominio("CAIXA_JA_ABERTO", "Você já tem um caixa aberto. Feche-o antes de abrir outro.");
    }
    const t: Turno = { id: novoId(), usuarioId, abertoEm: tx.relogio.agora().toISOString(), valorInicial, fechadoEm: null };
    await tx.db
      .insertInto("turnos_caixa")
      .values({ id: t.id, usuario_id: usuarioId, aberto_em: t.abertoEm, valor_inicial: valorInicial })
      .execute();
    await auditar(tx, { ator: usuarioId, acao: "caixa.abrir", alvoTipo: "turno_caixa", alvoId: t.id, dados: { valorInicial } });
    await registrarEvento(tx, "nucleo.CaixaAberto", { turnoId: t.id, usuarioId, valorInicial });
    return t;
  });
}

export async function fecharCaixa(ctx: Contexto, usuarioId: string, contados: Record<string, Centavos>): Promise<RelatorioTurno> {
  return emTransacao(ctx, async (tx) => {
    const t = await exigirCaixaAberto(tx, usuarioId);
    const movs = await tx.db
      .selectFrom("movimentos_caixa")
      .select(["forma_codigo", "valor"])
      .where("turno_id", "=", t.id)
      .execute();
    const esperado: Record<string, Centavos> = { dinheiro: t.valorInicial };
    for (const m of movs) esperado[m.forma_codigo] = (esperado[m.forma_codigo] ?? 0) + m.valor;
    const formas = [...new Set([...Object.keys(esperado), ...Object.keys(contados)])];
    const porForma = formas.map((forma) => {
      const e = esperado[forma] ?? 0;
      const c = contados[forma] ?? 0;
      return { forma, esperado: e, contado: c, diferenca: c - e };
    });
    const fechadoEm = tx.relogio.agora().toISOString();
    await tx.db
      .updateTable("turnos_caixa")
      .set({ fechado_em: fechadoEm, contados: JSON.stringify(contados) })
      .where("id", "=", t.id)
      .execute();
    await auditar(tx, { ator: usuarioId, acao: "caixa.fechar", alvoTipo: "turno_caixa", alvoId: t.id, dados: { contados, porForma } });
    await registrarEvento(tx, "nucleo.CaixaFechado", { turnoId: t.id, usuarioId, porForma });
    return { porForma };
  });
}
