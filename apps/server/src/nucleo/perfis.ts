import { sql } from "kysely";
import { auditar } from "../infra/auditoria.js";
import { registrarEvento } from "../infra/outbox.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { ErroDominio } from "../shared/erros.js";
import { PERMISSOES, type UsuarioSessao } from "./permissoes.js";
import { exigirAdministradorRestante } from "./usuarios.js";

export type Perfil = {
  nome: string;
  rotulo: string;
  padrao: boolean;
  limiteDesconto: number;
  permissoes: string[];
  usuarios: number;
};

/** Identificador interno: minúsculas, sem acento, palavras ligadas por hífen. */
function slug(rotulo: string): string {
  const s = rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "perfil";
}

async function montar(tx: Contexto, nome?: string): Promise<Perfil[]> {
  let q = tx.db.selectFrom("perfis").select(["nome", "rotulo", "padrao", "limite_desconto"]);
  if (nome) q = q.where("nome", "=", nome);
  const perfis = await q.orderBy("padrao", "desc").orderBy(sql`rowid`).execute();
  const perms = await tx.db.selectFrom("perfil_permissoes").select(["perfil", "permissao"]).orderBy("permissao").execute();
  const contagem = await tx.db.selectFrom("usuarios").select(["perfil", sql<number>`count(*)`.as("total")]).groupBy("perfil").execute();
  return perfis.map((p) => ({
    nome: p.nome,
    rotulo: p.rotulo,
    padrao: p.padrao === 1,
    limiteDesconto: p.limite_desconto,
    permissoes: perms.filter((x) => x.perfil === p.nome).map((x) => x.permissao),
    usuarios: Number(contagem.find((c) => c.perfil === p.nome)?.total ?? 0),
  }));
}

export async function listarPerfis(ctx: Contexto): Promise<Perfil[]> {
  return montar(ctx);
}

async function perfilOuErro(tx: Contexto, nome: string): Promise<Perfil> {
  const [p] = await montar(tx, nome);
  if (!p) throw new ErroDominio("PERFIL_NAO_ENCONTRADO", "Perfil não encontrado.");
  return p;
}

/** Dois perfis não podem ter o mesmo rótulo (ignora caixa, acentos, espaços e pontuação). */
async function exigirRotuloLivre(tx: Contexto, rotulo: string, exceto?: string): Promise<void> {
  const outros = await tx.db.selectFrom("perfis").select(["nome", "rotulo"]).execute();
  const chave = slug(rotulo);
  if (outros.some((p) => p.nome !== exceto && slug(p.rotulo) === chave)) {
    throw new ErroDominio("PERFIL_DUPLICADO", `Já existe um perfil chamado "${rotulo.trim()}".`, { rotulo: rotulo.trim() });
  }
}

export async function criarPerfil(ctx: Contexto, d: { rotulo: string; copiarDe: string }, autor: UsuarioSessao): Promise<Perfil> {
  return emTransacao(ctx, async (tx) => {
    const origem = await perfilOuErro(tx, d.copiarDe);
    await exigirRotuloLivre(tx, d.rotulo);
    const base = slug(d.rotulo);
    let nome = base;
    for (let n = 2; await tx.db.selectFrom("perfis").select("nome").where("nome", "=", nome).executeTakeFirst(); n++) nome = `${base}-${n}`;
    await tx.db.insertInto("perfis").values({ nome, rotulo: d.rotulo, padrao: 0, limite_desconto: origem.limiteDesconto }).execute();
    for (const permissao of origem.permissoes) await tx.db.insertInto("perfil_permissoes").values({ perfil: nome, permissao }).execute();
    await auditar(tx, { ator: autor.id, acao: "perfil.criar", alvoTipo: "perfil", alvoId: nome, dados: { rotulo: d.rotulo, copiarDe: d.copiarDe } });
    await registrarEvento(tx, "nucleo.PerfilCriado", { perfil: nome });
    return perfilOuErro(tx, nome);
  });
}

export async function editarPerfil(
  ctx: Contexto,
  nome: string,
  d: { rotulo?: string; limiteDesconto?: number; permissoes?: string[] },
  autor: UsuarioSessao,
): Promise<Perfil> {
  return emTransacao(ctx, async (tx) => {
    const atual = await perfilOuErro(tx, nome);
    if (d.rotulo !== undefined) await exigirRotuloLivre(tx, d.rotulo, nome);
    let permissoes: string[] | undefined;
    if (d.permissoes) {
      const invalidas = d.permissoes.filter((p) => !(PERMISSOES as readonly string[]).includes(p));
      if (invalidas.length > 0) throw new ErroDominio("PERMISSAO_INVALIDA", `Permissão desconhecida: ${invalidas.join(", ")}.`, { permissoes: invalidas });
      permissoes = [...new Set(d.permissoes)].sort();
      if (nome === "admin" && !permissoes.includes("config.gerenciar")) {
        throw new ErroDominio("PERFIL_ADMIN_PROTEGIDO", "O perfil Administrador precisa manter a permissão de configurar a pousada.");
      }
      await exigirAdministradorRestante(tx, { permissoesDoPerfil: { perfil: nome, permissoes } });
    }
    const campos: { rotulo?: string; limite_desconto?: number } = {};
    if (d.rotulo !== undefined) campos.rotulo = d.rotulo;
    if (d.limiteDesconto !== undefined) campos.limite_desconto = d.limiteDesconto;
    if (Object.keys(campos).length > 0) await tx.db.updateTable("perfis").set(campos).where("nome", "=", nome).execute();
    if (permissoes) {
      await tx.db.deleteFrom("perfil_permissoes").where("perfil", "=", nome).execute();
      for (const permissao of permissoes) await tx.db.insertInto("perfil_permissoes").values({ perfil: nome, permissao }).execute();
    }
    const novo = await perfilOuErro(tx, nome);
    await auditar(tx, {
      ator: autor.id,
      acao: "perfil.editar",
      alvoTipo: "perfil",
      alvoId: nome,
      dados: {
        de: { rotulo: atual.rotulo, limiteDesconto: atual.limiteDesconto, permissoes: atual.permissoes },
        para: { rotulo: novo.rotulo, limiteDesconto: novo.limiteDesconto, permissoes: novo.permissoes },
      },
    });
    await registrarEvento(tx, "nucleo.PerfilEditado", { perfil: nome });
    return novo;
  });
}

export async function excluirPerfil(ctx: Contexto, nome: string, autor: UsuarioSessao): Promise<void> {
  await emTransacao(ctx, async (tx) => {
    const p = await perfilOuErro(tx, nome);
    if (p.padrao) throw new ErroDominio("PERFIL_PADRAO", "Os perfis padrão não podem ser excluídos.");
    if (p.usuarios > 0) {
      throw new ErroDominio("PERFIL_COM_USUARIOS", "Este perfil tem usuários. Mude o perfil deles antes de excluir.", { usuarios: p.usuarios });
    }
    await tx.db.deleteFrom("perfil_permissoes").where("perfil", "=", nome).execute();
    await tx.db.deleteFrom("perfis").where("nome", "=", nome).execute();
    await auditar(tx, { ator: autor.id, acao: "perfil.excluir", alvoTipo: "perfil", alvoId: nome, dados: { rotulo: p.rotulo } });
    await registrarEvento(tx, "nucleo.PerfilExcluido", { perfil: nome });
  });
}
