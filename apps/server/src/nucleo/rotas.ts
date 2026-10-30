import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { data } from "../http/validacao.js";
import { emTransacao, type Contexto } from "../shared/contexto.js";
import { abrirCaixa, fecharCaixa, resumoCaixa } from "./caixa.js";
import { criarCategoria, definirCategoriaAtiva, editarCategoria, listarCategorias } from "./categorias.js";
import { listarFormas } from "./formas-pagamento.js";
import { buscarHospedes, obterHospede, salvarHospede } from "./hospedes.js";
import { exigirPermissao } from "./permissoes.js";
import { obterConfig, salvarConfig, type ConfigPousada } from "./pousada.js";
import { SETORES, type Setor } from "../governanca/setores.js";
import { criarProduto, definirProdutoAtivo, editarProduto, listarProdutos } from "./produtos.js";
import { criarQuarto, criarQuartosEmLote, definirQuartoAtivo, editarQuarto, listarQuartos } from "./quartos.js";
import { entrar, sair } from "./sessoes.js";
import { criarUsuario, definirUsuarioAtivo, editarUsuario, listarUsuarios, redefinirSenha, TAM_MIN_SENHA, trocarSenha } from "./usuarios.js";

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM");
const centavos = z.number().int().min(0);
const naoNegativo = z.number().min(0);
const texto = z.string().trim().min(1, "Campo obrigatório");
const regraTaxa = z.object({ tipo: z.enum(["fixo", "percentual_diaria"]), valor: centavos }).partial();

const corpoConfig = z
  .object({
    razaoSocial: z.string(),
    cnpj: z.string(),
    endereco: z.string(),
    fuso: texto,
    horaCheckin: hora,
    horaCheckout: hora,
    viradaDia: hora,
    arredondamento: z.enum(["nenhum", "real"]),
    sinal: z
      .object({
        exigir: z.boolean(),
        tipo: z.enum(["percentual", "primeira_diaria"]),
        percentual: naoNegativo,
        prazoHoras: naoNegativo,
        toleranciaHoras: naoNegativo,
      })
      .partial(),
    earlyCheckin: regraTaxa,
    lateCheckout: regraTaxa,
    idadeAdulto: naoNegativo,
    limiteCriancasGratis: naoNegativo,
    camareiraLancaFrigobar: z.boolean(),
  })
  .partial();

const corpoCategoria = z.object({
  nome: texto,
  maxAdultos: z.number().int().min(1),
  maxCriancas: z.number().int().min(0),
  comodidades: z.array(z.string()).default([]),
});
const corpoQuarto = z.object({ numero: texto, categoriaId: texto, bloco: z.string().optional() });
const corpoEdicaoQuarto = z.object({ numero: texto, categoriaId: texto, bloco: z.string().nullish() });
const corpoLote = z.object({ categoriaId: texto, de: z.number().int().min(0), ate: z.number().int().min(0), bloco: z.string().optional() });
const paramId = z.object({ id: z.string().min(1) });
const flagInativos = z.enum(["1", "true"]).optional();
const corpoHospede = z.object({
  id: z.string().optional(),
  nome: texto,
  documentoTipo: z.enum(["cpf", "passaporte"]),
  documento: z.string().nullable(),
  nascimento: data.nullable(),
  nacionalidade: texto,
  telefone: z.string().optional(),
  email: z.string().optional(),
  endereco: z
    .object({ logradouro: z.string(), cidade: z.string(), uf: z.string(), pais: z.string(), cep: z.string().optional() })
    .optional(),
  observacoes: z.string().optional(),
});
const corpoProduto = z.object({
  codigo: texto,
  nome: texto,
  precoCentavos: centavos,
  unidade: texto,
  grupo: texto,
  tipo: z.enum(["produto", "servico"]),
  setores: z.array(z.enum(SETORES as [Setor, ...Setor[]])).min(1, "Informe ao menos um setor").optional(),
});
const corpoEdicaoProduto = z.object({
  nome: texto,
  precoCentavos: centavos,
  unidade: texto,
  tipo: z.enum(["produto", "servico"]),
  setores: z.array(z.enum(SETORES as [Setor, ...Setor[]])).min(1, "Informe ao menos um setor"),
});
const queryProdutos = z.object({ setor: z.enum(SETORES as [Setor, ...Setor[]]).optional(), incluirInativos: flagInativos });
const corpoUsuario = z.object({ nome: texto, login: texto, senha: z.string().min(1, "Campo obrigatório"), perfil: texto });
const corpoEdicaoUsuario = z.object({ nome: texto, perfil: texto });
const corpoAbrirCaixa = z.object({ valorInicial: centavos });
const corpoFecharCaixa = z.object({ contados: z.record(z.string(), centavos).default({}) });
const corpoTrocaSenha = z
  .object({ senhaAtual: z.string().min(1, "Campo obrigatório"), novaSenha: z.string().min(TAM_MIN_SENHA, `Use pelo menos ${TAM_MIN_SENHA} caracteres`) })
  .refine((c) => c.novaSenha !== c.senhaAtual, { message: "A nova senha deve ser diferente da atual", path: ["novaSenha"] });
const corpoLogin = z.object({ login: z.string().min(1), senha: z.string().min(1) });

export function registrarRotasBase(app: FastifyInstance, ctx: Contexto): void {
  app.post("/api/sessoes", async (req, res) => {
    const { login, senha } = corpoLogin.parse(req.body);
    return res.status(201).send(await entrar(ctx, login, senha));
  });
  app.delete("/api/sessoes", async (req, res) => {
    await sair(ctx, req.token);
    return res.status(204).send();
  });

  app.get("/api/config", async () => obterConfig(ctx));
  app.put("/api/config", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    // salvarConfig mescla os subobjetos parciais (sinal, taxas) com os valores atuais.
    return salvarConfig(ctx, corpoConfig.parse(req.body) as Partial<ConfigPousada>, req.usuario.id);
  });

  /** `?incluirInativos=1` exige cadastros.gerenciar. */
  const incluirInativos = (req: { usuario: Parameters<typeof exigirPermissao>[0] }, flag: string | undefined): boolean => {
    if (!flag) return false;
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return true;
  };

  app.get("/api/categorias", async (req) => {
    const q = z.object({ incluirInativos: flagInativos }).parse(req.query);
    return listarCategorias(ctx, { incluirInativos: incluirInativos(req, q.incluirInativos) });
  });
  app.put("/api/categorias/:id", async (req) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return editarCategoria(ctx, paramId.parse(req.params).id, corpoCategoria.parse(req.body), req.usuario.id);
  });
  for (const [acao, ativa] of [["desativar", false], ["reativar", true]] as const) {
    app.post(`/api/categorias/:id/${acao}`, async (req, res) => {
      exigirPermissao(req.usuario, "cadastros.gerenciar");
      await definirCategoriaAtiva(ctx, paramId.parse(req.params).id, ativa, req.usuario.id);
      return res.status(200).send({ ok: true });
    });
    app.post(`/api/quartos/:id/${acao}`, async (req, res) => {
      exigirPermissao(req.usuario, "cadastros.gerenciar");
      await definirQuartoAtivo(ctx, paramId.parse(req.params).id, ativa, req.usuario.id);
      return res.status(200).send({ ok: true });
    });
    app.post(`/api/produtos/:id/${acao}`, async (req, res) => {
      exigirPermissao(req.usuario, "cadastros.gerenciar");
      await definirProdutoAtivo(ctx, paramId.parse(req.params).id, ativa, req.usuario.id);
      return res.status(200).send({ ok: true });
    });
  }
  app.post("/api/categorias", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return res.status(201).send(await criarCategoria(ctx, corpoCategoria.parse(req.body), req.usuario.id));
  });

  app.get("/api/quartos", async (req) => {
    const q = z.object({ categoriaId: z.string().optional(), incluirInativos: flagInativos }).parse(req.query);
    return listarQuartos(ctx, { ...(q.categoriaId ? { categoriaId: q.categoriaId } : {}), incluirInativos: incluirInativos(req, q.incluirInativos) });
  });
  app.put("/api/quartos/:id", async (req) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return editarQuarto(ctx, paramId.parse(req.params).id, corpoEdicaoQuarto.parse(req.body), req.usuario.id);
  });
  app.post("/api/quartos/lote", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    const corpo = corpoLote.parse(req.body);
    return res.status(201).send(await emTransacao(ctx, (tx) => criarQuartosEmLote(tx, corpo, req.usuario.id)));
  });
  app.post("/api/quartos", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return res.status(201).send(await criarQuarto(ctx, corpoQuarto.parse(req.body), req.usuario.id));
  });

  app.get("/api/hospedes", async (req) => {
    exigirPermissao(req.usuario, "reservas.gerenciar");
    const { q } = z.object({ q: z.string().default("") }).parse(req.query);
    return buscarHospedes(ctx, q);
  });
  app.get("/api/hospedes/:id", async (req) => {
    exigirPermissao(req.usuario, "reservas.gerenciar");
    return obterHospede(ctx, z.object({ id: z.string().min(1) }).parse(req.params).id);
  });
  app.post("/api/hospedes", async (req, res) => {
    exigirPermissao(req.usuario, "reservas.gerenciar");
    return res.status(201).send(await salvarHospede(ctx, corpoHospede.parse(req.body), req.usuario.id));
  });

  app.get("/api/produtos", async (req) => {
    const q = queryProdutos.parse(req.query);
    return listarProdutos(ctx, q.setor, { incluirInativos: incluirInativos(req, q.incluirInativos) });
  });
  app.put("/api/produtos/:id", async (req) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return editarProduto(ctx, paramId.parse(req.params).id, corpoEdicaoProduto.parse(req.body), req.usuario.id);
  });
  app.post("/api/produtos", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return res.status(201).send(await criarProduto(ctx, corpoProduto.parse(req.body), req.usuario.id));
  });

  app.get("/api/formas-pagamento", async () => listarFormas(ctx));

  app.post("/api/usuarios", async (req, res) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return res.status(201).send(await criarUsuario(ctx, corpoUsuario.parse(req.body), req.usuario.id));
  });

  app.get("/api/usuarios", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return listarUsuarios(ctx);
  });
  app.put("/api/usuarios/:id", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return editarUsuario(ctx, paramId.parse(req.params).id, corpoEdicaoUsuario.parse(req.body), req.usuario);
  });
  for (const [acao, ativo] of [["desativar", false], ["reativar", true]] as const) {
    app.post(`/api/usuarios/:id/${acao}`, async (req, res) => {
      exigirPermissao(req.usuario, "config.gerenciar");
      await definirUsuarioAtivo(ctx, paramId.parse(req.params).id, ativo, req.usuario);
      return res.status(204).send();
    });
  }
  app.post("/api/usuarios/:id/redefinir-senha", async (req) => {
    exigirPermissao(req.usuario, "config.gerenciar");
    return redefinirSenha(ctx, paramId.parse(req.params).id, req.usuario);
  });
  app.put("/api/usuarios/me/senha", async (req, res) => {
    const { senhaAtual, novaSenha } = corpoTrocaSenha.parse(req.body);
    await trocarSenha(ctx, req.usuario.id, senhaAtual, novaSenha);
    return res.status(204).send();
  });

  app.post("/api/caixa/abrir", async (req, res) => {
    exigirPermissao(req.usuario, "caixa.operar");
    const { valorInicial } = corpoAbrirCaixa.parse(req.body);
    return res.status(201).send(await abrirCaixa(ctx, req.usuario.id, valorInicial));
  });
  app.post("/api/caixa/fechar", async (req) => {
    exigirPermissao(req.usuario, "caixa.operar");
    const { contados } = corpoFecharCaixa.parse(req.body);
    return fecharCaixa(ctx, req.usuario.id, contados);
  });
  app.get("/api/caixa/atual", async (req) => {
    exigirPermissao(req.usuario, "caixa.operar");
    return resumoCaixa(ctx, req.usuario.id);
  });
}
