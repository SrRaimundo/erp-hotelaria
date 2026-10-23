import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";

export type RegraTaxa = { tipo: "fixo" | "percentual_diaria"; valor: number };

export type ConfigPousada = {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  fuso: string;
  horaCheckin: string;
  horaCheckout: string;
  viradaDia: string;
  arredondamento: "nenhum" | "real";
  sinal: {
    exigir: boolean;
    tipo: "percentual" | "primeira_diaria";
    percentual: number;
    prazoHoras: number;
    toleranciaHoras: number;
  };
  earlyCheckin: RegraTaxa;
  lateCheckout: RegraTaxa;
  idadeAdulto: number;
  limiteCriancasGratis: number;
};

export const CONFIG_PADRAO: ConfigPousada = {
  razaoSocial: "",
  cnpj: "",
  endereco: "",
  fuso: "America/Sao_Paulo",
  horaCheckin: "14:00",
  horaCheckout: "12:00",
  viradaDia: "04:00",
  arredondamento: "nenhum",
  sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 },
  earlyCheckin: { tipo: "fixo", valor: 0 },
  lateCheckout: { tipo: "fixo", valor: 0 },
  idadeAdulto: 12,
  limiteCriancasGratis: 1,
};

function mesclar(base: ConfigPousada, parcial: Partial<ConfigPousada>): ConfigPousada {
  const r = { ...base, ...parcial } as ConfigPousada;
  r.sinal = { ...base.sinal, ...(parcial.sinal ?? {}) };
  r.earlyCheckin = { ...base.earlyCheckin, ...(parcial.earlyCheckin ?? {}) };
  r.lateCheckout = { ...base.lateCheckout, ...(parcial.lateCheckout ?? {}) };
  return r;
}

export async function obterConfig(ctx: Contexto): Promise<ConfigPousada> {
  const linha = await ctx.db.selectFrom("config_pousada").select("dados").where("id", "=", 1).executeTakeFirst();
  return mesclar(CONFIG_PADRAO, linha ? JSON.parse(linha.dados) : {});
}

export async function salvarConfig(ctx: Contexto, parcial: Partial<ConfigPousada>, ator: string): Promise<ConfigPousada> {
  return emTransacao(ctx, async (tx) => {
    const nova = mesclar(await obterConfig(tx), parcial);
    const dados = JSON.stringify(nova);
    await tx.db
      .insertInto("config_pousada")
      .values({ id: 1, dados })
      .onConflict((oc) => oc.column("id").doUpdateSet({ dados }))
      .execute();
    await auditar(tx, { ator, acao: "pousada.config", alvoTipo: "pousada", alvoId: "1", dados: parcial });
    await registrarEvento(tx, "nucleo.ConfigPousadaAlterada", { campos: Object.keys(parcial) });
    return nova;
  });
}
