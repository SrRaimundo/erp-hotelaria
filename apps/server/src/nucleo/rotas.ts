import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { data } from "../http/validacao.js";
import type { Contexto } from "../shared/contexto.js";
import { abrirCaixa, fecharCaixa, turnoAberto } from "./caixa.js";
import { criarCategoria, listarCategorias } from "./categorias.js";
import { listarFormas } from "./formas-pagamento.js";
import { buscarHospedes, salvarHospede } from "./hospedes.js";
import { exigirPermissao } from "./permissoes.js";
import { obterConfig, salvarConfig, type ConfigPousada } from "./pousada.js";
import { criarProduto, listarProdutos } from "./produtos.js";
import { criarQuarto, listarQuartos } from "./quartos.js";
import { entrar, sair } from "./sessoes.js";
import { criarUsuario, TAM_MIN_SENHA, trocarSenha } from "./usuarios.js";

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
  })
  .partial();

const corpoCategoria = z.object({
  nome: texto,
  maxAdultos: z.number().int().min(1),
  maxCriancas: z.number().int().min(0),
  comodidades: z.array(z.string()).default([]),
});
const corpoQuarto = z.object({ numero: texto, categoriaId: texto, bloco: z.string().optional() });
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
});
const corpoUsuario = z.object({ nome: texto, login: texto, senha: z.string().min(1, "Campo obrigatório"), perfil: texto });
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

  app.get("/api/categorias", async () => listarCategorias(ctx));
  app.post("/api/categorias", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return res.status(201).send(await criarCategoria(ctx, corpoCategoria.parse(req.body), req.usuario.id));
  });

  app.get("/api/quartos", async (req) => {
    const { categoriaId } = z.object({ categoriaId: z.string().optional() }).parse(req.query);
    return listarQuartos(ctx, categoriaId ? { categoriaId } : undefined);
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
  app.post("/api/hospedes", async (req, res) => {
    exigirPermissao(req.usuario, "reservas.gerenciar");
    return res.status(201).send(await salvarHospede(ctx, corpoHospede.parse(req.body), req.usuario.id));
  });

  app.get("/api/produtos", async () => listarProdutos(ctx));
  app.post("/api/produtos", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return res.status(201).send(await criarProduto(ctx, corpoProduto.parse(req.body), req.usuario.id));
  });

  app.get("/api/formas-pagamento", async () => listarFormas(ctx));

  app.post("/api/usuarios", async (req, res) => {
    exigirPermissao(req.usuario, "cadastros.gerenciar");
    return res.status(201).send(await criarUsuario(ctx, corpoUsuario.parse(req.body), req.usuario.id));
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
    return turnoAberto(ctx, req.usuario.id);
  });
}
