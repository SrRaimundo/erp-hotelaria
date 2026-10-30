import { auditar } from "../infra/auditoria.js";
import { criarCategoria } from "../nucleo/categorias.js";
import { obterConfig, salvarConfig } from "../nucleo/pousada.js";
import { criarQuartosEmLote } from "../nucleo/quartos.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import type { Centavos } from "../shared/dinheiro.js";
import { ErroDominio } from "../shared/erros.js";
import { salvarTabelaBase } from "../tarifas/regras.js";

export type EstadoAssistente = {
  pousada: boolean;
  quartos: boolean;
  equipe: boolean;
  categorias: { id: string; nome: string; quartos: string[] }[];
};

export type CategoriaAssistente = {
  nome: string;
  maxAdultos: number;
  maxCriancas: number;
  porAdultos: Record<1 | 2 | 3, Centavos>;
  adultoExtra: Centavos;
  de: number;
  ate: number;
  bloco?: string;
};

const MAX_LOTE = 200;

/** Comparação de nomes sem caixa, sem acento e sem espaços nas pontas. */
function chaveNome(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

export async function estadoAssistente(ctx: Contexto): Promise<EstadoAssistente> {
  const config = await obterConfig(ctx);
  const quartosAtivos = await ctx.db
    .selectFrom("quartos")
    .select(["numero", "categoria_id"])
    .where("ativo", "=", 1)
    .execute();
  const outroUsuario = await ctx.db
    .selectFrom("usuarios")
    .select("id")
    .where("ativo", "=", 1)
    .where("id", "!=", "usuario-admin")
    .executeTakeFirst();
  const categorias = await ctx.db.selectFrom("categorias").select(["id", "nome"]).where("ativo", "=", 1).orderBy("nome").orderBy("id").execute();
  const ordemNumero = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });
  return {
    pousada: config.razaoSocial.trim() !== "",
    quartos: quartosAtivos.length > 0,
    equipe: outroUsuario !== undefined || config.assistenteEquipePulado,
    categorias: categorias.map((c) => ({
      id: c.id,
      nome: c.nome,
      quartos: quartosAtivos.filter((q) => q.categoria_id === c.id).map((q) => q.numero).sort(ordemNumero),
    })),
  };
}

/**
 * Cria categorias, tabelas base e quartos numa só transação. Nome repetido no pedido ou já existente
 * (inclusive categoria desativada) → CATEGORIA_DUPLICADA; faixas que se cruzam entre si ou com quartos
 * existentes → NUMERO_QUARTO_DUPLICADO (detalhes.numeros). Em qualquer erro nada é gravado.
 */
export async function configurarQuartos(
  ctx: Contexto,
  d: { categorias: CategoriaAssistente[] },
  ator: string,
): Promise<EstadoAssistente> {
  if (d.categorias.length === 0) throw new ErroDominio("ASSISTENTE_VAZIO", "Informe ao menos uma categoria.");
  for (const c of d.categorias) {
    if (!Number.isInteger(c.de) || !Number.isInteger(c.ate) || c.de < 0 || c.ate < c.de || c.ate - c.de + 1 > MAX_LOTE) {
      throw new ErroDominio(
        "LOTE_INVALIDO",
        `Faixa de quartos inválida em "${c.nome}". Use números inteiros, com o final maior ou igual ao início, até ${MAX_LOTE} quartos.`,
        { maximo: MAX_LOTE },
      );
    }
  }
  const vistos = new Set<string>();
  for (const c of d.categorias) {
    const k = chaveNome(c.nome);
    if (vistos.has(k)) throw new ErroDominio("CATEGORIA_DUPLICADA", `A categoria "${c.nome}" aparece mais de uma vez no pedido.`, { nome: c.nome });
    vistos.add(k);
  }
  const cruzados = new Set<number>();
  d.categorias.forEach((a, i) => {
    for (const b of d.categorias.slice(i + 1)) {
      for (let n = Math.max(a.de, b.de); n <= Math.min(a.ate, b.ate); n++) cruzados.add(n);
    }
  });
  if (cruzados.size > 0) {
    const numeros = [...cruzados].sort((x, y) => x - y).map(String);
    throw new ErroDominio("NUMERO_QUARTO_DUPLICADO", `Os números ${numeros.join(", ")} estão em mais de uma categoria. Nada foi criado.`, { numeros });
  }

  return emTransacao(ctx, async (tx) => {
    const existentes = await tx.db.selectFrom("categorias").select("nome").execute();
    const nomesExistentes = new Set(existentes.map((e) => chaveNome(e.nome)));
    for (const c of d.categorias) {
      if (nomesExistentes.has(chaveNome(c.nome))) {
        throw new ErroDominio("CATEGORIA_DUPLICADA", `Já existe uma categoria chamada "${c.nome.trim()}".`, { nome: c.nome.trim() });
      }
    }
    for (const c of d.categorias) {
      const cat = await criarCategoria(tx, { nome: c.nome.trim(), maxAdultos: c.maxAdultos, maxCriancas: c.maxCriancas, comodidades: [] }, ator);
      await salvarTabelaBase(tx, { categoriaId: cat.id, porAdultos: c.porAdultos, adultoExtra: c.adultoExtra }, ator);
      await criarQuartosEmLote(tx, { categoriaId: cat.id, de: c.de, ate: c.ate, ...(c.bloco ? { bloco: c.bloco } : {}) }, ator);
    }
    await auditar(tx, {
      ator,
      acao: "assistente.quartos",
      alvoTipo: "pousada",
      alvoId: "1",
      dados: { categorias: d.categorias.map((c) => c.nome.trim()) },
    });
    return estadoAssistente(tx);
  });
}

export async function pularEquipe(ctx: Contexto, ator: string): Promise<EstadoAssistente> {
  await salvarConfig(ctx, { assistenteEquipePulado: true }, ator);
  return estadoAssistente(ctx);
}
