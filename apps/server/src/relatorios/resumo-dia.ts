import { listarFormas } from "../nucleo/formas-pagamento.js";
import { obterConfig } from "../nucleo/pousada.js";
import { formatarBRL } from "../shared/dinheiro.js";
import { diaHoteleiro, somarDias } from "../shared/tempo.js";
import { VENDIDAS } from "./canais.js";
import { dataOuHoje, filtroData } from "./consulta.js";
import { dataBR, percentual } from "./formato.js";
import { definir, type Relatorio } from "./modelo.js";

/** Produtos das taxas de early check-in e late check-out; os demais extras são "Extras". */
const PRODUTOS_TAXA = ["prod-early-checkin", "prod-late-checkout"];

export const relatorioResumoDia = definir({
  id: "resumo-dia",
  permissao: "reservas.gerenciar",
  filtros: filtroData,
  gerar: async (ctx, f): Promise<Relatorio> => {
    const dia = await dataOuHoje(ctx, f.data);
    const { fuso, viradaDia } = await obterConfig(ctx);
    const doDia = (instante: string) => diaHoteleiro(new Date(instante), fuso, viradaDia) === dia;
    // folga de dois dias para cada lado: fuso e virada deslocam o dia, o filtro exato é o doDia
    const de = `${somarDias(dia, -2)}T00:00:00.000Z`, ate = `${somarDias(dia, 3)}T00:00:00.000Z`;

    const quartos = Number((await ctx.db.selectFrom("quartos").select((eb) => eb.fn.countAll().as("n")).where("ativo", "=", 1).executeTakeFirstOrThrow()).n);
    const reservas = await ctx.db.selectFrom("reservas").select(["estado", "chegada", "saida", "criada_em"]).where("chegada", "<=", dia).where("saida", ">=", dia).execute();
    const chegadas = reservas.filter((r) => r.chegada === dia && (VENDIDAS as readonly string[]).includes(r.estado)).length;
    const saidas = reservas.filter((r) => r.saida === dia && ["hospedada", "finalizada"].includes(r.estado)).length;
    const hospedados = reservas.filter((r) => r.chegada <= dia && r.saida > dia && ["hospedada", "finalizada"].includes(r.estado)).length;
    const noShows = reservas.filter((r) => r.chegada === dia && r.estado === "no_show").length;
    const cancelamentos = reservas.filter((r) => r.chegada === dia && r.estado === "cancelada").length;
    const novas = (await ctx.db.selectFrom("reservas").select("criada_em").where("criada_em", ">=", de).where("criada_em", "<", ate).execute()).filter((r) => doDia(r.criada_em)).length;

    // Receita lançada: diária pela noite a que se refere; extras, taxas e estornos pelo dia do lançamento. Estorno vale como a origem.
    const lancs = await ctx.db
      .selectFrom("lancamentos as l")
      .leftJoin("lancamentos as o", "o.id", "l.estorna_id")
      .select(["l.tipo", "l.valor", "l.data_ref", "l.instante", "l.produto_id", "o.tipo as origemTipo", "o.produto_id as origemProduto"])
      .where((eb) => eb.or([eb("l.data_ref", "=", dia), eb.and([eb("l.instante", ">=", de), eb("l.instante", "<", ate)])]))
      .execute();
    const receita = { hospedagem: 0, taxas: 0, extras: 0 };
    for (const l of lancs) {
      const tipo = l.tipo === "estorno" ? l.origemTipo : l.tipo;
      const quando = l.tipo === "diaria" ? l.data_ref === dia : doDia(l.instante);
      if (!quando) continue;
      if (tipo === "diaria") receita.hospedagem += l.valor;
      else if (PRODUTOS_TAXA.includes((l.tipo === "estorno" ? l.origemProduto : l.produto_id) ?? "")) receita.taxas += l.valor;
      else receita.extras += l.valor;
    }
    const totalReceita = receita.hospedagem + receita.taxas + receita.extras;

    // Recebimentos: pagamentos e estornos de pagamento do dia, somados com sinal. Faturado não entra: não passou pelo caixa.
    const pags = await ctx.db.selectFrom("pagamentos").select(["forma_codigo", "valor", "instante"]).where("instante", ">=", de).where("instante", "<", ate).where("forma_codigo", "!=", "faturado").execute();
    const porForma = new Map<string, number>();
    for (const p of pags) if (doDia(p.instante)) porForma.set(p.forma_codigo, (porForma.get(p.forma_codigo) ?? 0) + p.valor);
    const nomes = new Map((await listarFormas(ctx, false)).map((x) => [x.codigo as string, x.nome]));
    const linhasForma = [...porForma].sort((a, b) => (nomes.get(a[0]) ?? a[0]).localeCompare(nomes.get(b[0]) ?? b[0], "pt-BR")).map(([c, v]) => ({ forma: nomes.get(c) ?? c, valor: v }));
    const totalRecebido = linhasForma.reduce((t, x) => t + x.valor, 0);

    return {
      id: "resumo-dia",
      titulo: "Resumo do dia",
      subtitulo: `Dia ${dataBR(dia)} · receita pelos lançamentos do dia · recebimentos líquidos de estornos, sem faturado`,
      geradoEm: ctx.relogio.agora().toISOString(),
      resumo: [
        { rotulo: "Chegadas", valor: String(chegadas) },
        { rotulo: "Saídas", valor: String(saidas) },
        { rotulo: "Hospedados", valor: String(hospedados) },
        { rotulo: "Ocupação", valor: percentual(hospedados, quartos) },
        { rotulo: "No-shows", valor: String(noShows) },
        { rotulo: "Cancelamentos (chegada no dia)", valor: String(cancelamentos) },
        { rotulo: "Novas reservas", valor: String(novas) },
        { rotulo: "Receita do dia", valor: formatarBRL(totalReceita) },
        { rotulo: "Recebido no dia", valor: formatarBRL(totalRecebido) },
      ],
      secoes: [
        {
          titulo: "Receita",
          colunas: [{ chave: "tipo", titulo: "Tipo", tipo: "texto" }, { chave: "valor", titulo: "Valor", tipo: "dinheiro" }],
          linhas: [
            { tipo: "Hospedagem (diárias do dia)", valor: receita.hospedagem },
            { tipo: "Taxas (early check-in, late check-out)", valor: receita.taxas },
            { tipo: "Extras", valor: receita.extras },
          ],
          totais: { valor: totalReceita },
        },
        {
          titulo: "Recebimentos por forma de pagamento",
          colunas: [{ chave: "forma", titulo: "Forma", tipo: "texto" }, { chave: "valor", titulo: "Valor", tipo: "dinheiro" }],
          linhas: linhasForma,
          totais: { valor: totalRecebido },
        },
      ],
    };
  },
});
