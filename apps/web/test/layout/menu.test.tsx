import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MenuLateral } from "../../src/layout/MenuLateral";
import { AppRotas } from "../../src/rotas";
import { instalarApiFalsa } from "../api-falsa";
import { criarPainel } from "../fixtures/painel";
import { aguardarConsultas, renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

function Sonda() {
  return <output data-testid="local">{useLocation().pathname}</output>;
}

const painel = { "GET /api/painel": criarPainel() };

const tudo = ["reservas.gerenciar", "caixa.operar", "financeiro.gerenciar", "quartos.situacao", "config.gerenciar", "cadastros.gerenciar"];
const nomesLinks = (el: HTMLElement) => within(el).queryAllByRole("link").map((a) => a.textContent);
const cabecalhos = () => within(screen.getByRole("navigation", { name: "Menu principal" })).getAllByRole("button").map((b) => b.textContent);

describe("menu em grupos", () => {
  test("grupos na ordem e grafia do desenho, cada um com seus itens na ordem", async () => {
    const u = userEvent.setup();
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/mapa", usuario: { permissoes: tudo } });
    await aguardarConsultas(cliente);
    expect(cabecalhos()).toEqual(["Hotel", "Financeiro", "Estoque", "Cadastros"]);
    const itens = async (grupo: string, esperado: string[]) => {
      const botao = screen.getByRole("button", { name: grupo });
      if (botao.getAttribute("aria-expanded") !== "true") await u.click(botao);
      const regiao = document.getElementById(botao.getAttribute("aria-controls")!)!;
      expect(nomesLinks(regiao)).toEqual(esperado);
    };
    await itens("Hotel", ["Hoje", "Mapa", "Reservas", "Caixa", "Governança", "Relatórios"]);
    await itens("Financeiro", ["Local", "Contas a Pagar", "Contas a Receber", "Cartão de Crédito", "Caixa e Banco", "Faturamento", "Relatórios"]);
    await itens("Estoque", ["Local", "Fiscal", "Movimento", "Requisição", "Serviço", "Compra", "Inventário", "Relatórios"]);
    await itens("Cadastros", ["Produtos", "Categorias e Quartos", "Setores", "Fornecedor", "Cobrança", "Tipo de Documento", "Grupo", "SubGrupo", "Contas Bancárias", "Locais", "Relatórios"]);
    expect(screen.getByRole("link", { name: "Cartão de Crédito" })).toHaveAttribute("href", "/financeiro/cartao-de-credito");
    expect(screen.getAllByRole("link", { name: "Relatórios" }).map((l) => l.getAttribute("href"))).toEqual(["/relatorios", "/financeiro/relatorios", "/estoque/relatorios", "/cadastros/relatorios"]);
  });

  test("só o grupo da rota atual começa aberto e o cabeçalho alterna", async () => {
    const u = userEvent.setup();
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/estoque/fiscal", usuario: { permissoes: tudo } });
    await aguardarConsultas(cliente);
    const estoque = screen.getByRole("button", { name: "Estoque" });
    expect(estoque).toHaveAttribute("aria-expanded", "true");
    for (const n of ["Hotel", "Financeiro", "Cadastros"]) expect(screen.getByRole("button", { name: n })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Mapa" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fiscal" })).toHaveAttribute("aria-current", "page");
    await u.click(screen.getByRole("button", { name: "Hotel" }));
    expect(screen.getByRole("button", { name: "Hotel" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Mapa" })).toBeInTheDocument();
    await u.click(estoque);
    expect(estoque).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Fiscal" })).not.toBeInTheDocument();
  });

  test("sub-rota pertence ao grupo do item (/reservas/nova abre Hotel)", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/reservas/nova", usuario: { permissoes: tudo } });
    await aguardarConsultas(cliente);
    expect(screen.getByRole("button", { name: "Hotel" })).toHaveAttribute("aria-expanded", "true");
  });

  test("navegar para outro grupo abre o grupo daquela rota", async () => {
    instalarApiFalsa(painel);
    const u = userEvent.setup();
    renderizar(<AppRotas />, { rota: "/estoque/fiscal", usuario: { permissoes: tudo } });
    await u.click(screen.getByRole("button", { name: "Cadastros" }));
    await u.click(screen.getByRole("link", { name: "Setores" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Setores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastros" })).toHaveAttribute("aria-expanded", "true");
  });

  test("itens sem permissão somem e grupo sem itens visíveis também", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["reservas.gerenciar", "caixa.operar", "financeiro.gerenciar", "config.gerenciar"] } });
    await aguardarConsultas(cliente);
    // Cadastros aparece só pela Cobrança (permissão financeira), sem os cadastros gerais.
    expect(cabecalhos()).toEqual(["Hotel", "Financeiro", "Estoque", "Cadastros"]);
    await userEvent.click(screen.getByRole("button", { name: /^Cadastros/ }));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toContain("Cobrança");
    expect(screen.queryByRole("link", { name: "Produtos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Governança" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Caixa" })).toBeInTheDocument();
  });

  test("Financeiro some sem financeiro.gerenciar, mesmo com config.gerenciar e caixa.operar", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["reservas.gerenciar", "caixa.operar", "config.gerenciar"] } });
    await aguardarConsultas(cliente);
    expect(screen.queryByRole("button", { name: "Financeiro" })).not.toBeInTheDocument();
    expect(cabecalhos()).toEqual(["Hotel", "Estoque"]);
  });

  test("Financeiro aparece só com financeiro.gerenciar", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["financeiro.gerenciar"] } });
    await aguardarConsultas(cliente);
    expect(cabecalhos()).toEqual(["Financeiro", "Cadastros"]);
  });

  test("Cobrança (cadastro do Financeiro) não aparece para quem só tem cadastros.gerenciar", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/cadastros/produtos", usuario: { permissoes: ["cadastros.gerenciar"] } });
    await aguardarConsultas(cliente);
    expect(screen.queryByRole("link", { name: "Cobrança" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Produtos" })).toBeInTheDocument();
  });

  test("só cadastros.gerenciar: apenas o grupo Cadastros, sem engrenagem", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { rota: "/cadastros/produtos", usuario: { permissoes: ["cadastros.gerenciar"] } });
    await aguardarConsultas(cliente);
    expect(cabecalhos()).toEqual(["Cadastros"]);
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
  });

  test("a engrenagem tem rótulo, título e ícone, e fica ao lado do Sair", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["config.gerenciar"] } });
    await aguardarConsultas(cliente);
    const g = screen.getByRole("link", { name: "Configurações" });
    expect(g).toHaveAttribute("title", "Configurações");
    expect(g.parentElement).toContainElement(screen.getByRole("button", { name: "Sair" }));
    expect(g.querySelector("svg")).not.toBeNull();
  });

  test("menu simples: um só destino mostra nome e Sair, sem grupos nem engrenagem", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={0} />, { usuario: { nome: "Gil", permissoes: ["quartos.situacao"] } });
    await aguardarConsultas(cliente);
    expect(screen.queryByRole("navigation", { name: "Menu principal" })).not.toBeInTheDocument();
    expect(screen.getByText("Gil")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
  });

  test("o contador de atenção continua em Hoje", async () => {
    const { cliente } = renderizar(<MenuLateral atencao={3} />, { rota: "/", usuario: { permissoes: ["reservas.gerenciar"] } });
    await aguardarConsultas(cliente);
    expect(screen.getByLabelText("3 itens de atenção")).toHaveTextContent("3");
  });
});

describe("marca do menu", () => {
  const marca = (container: HTMLElement) => container.querySelector(".menu__marca")!.textContent;

  test("usa o nome do estabelecimento, senão a razão social, senão ALICE", async () => {
    instalarApiFalsa({ "GET /api/config": { nomeEstabelecimento: "Vista Alegre", razaoSocial: "Vista Alegre Ltda" } });
    let r = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: tudo } });
    await waitFor(() => expect(marca(r.container)).toBe("Vista Alegre"));
    r.unmount();

    instalarApiFalsa({ "GET /api/config": { nomeEstabelecimento: "  ", razaoSocial: "Vista Alegre Ltda" } });
    r = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: tudo } });
    await waitFor(() => expect(marca(r.container)).toBe("Vista Alegre Ltda"));
    r.unmount();

    instalarApiFalsa({ "GET /api/config": { nomeEstabelecimento: "", razaoSocial: "" } });
    r = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: tudo } });
    await waitFor(() => expect(marca(r.container)).toBe("ALICE"));
  });

  test("antes da config chegar mostra ALICE", async () => {
    const r = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: tudo } });
    expect(marca(r.container)).toBe("ALICE");
    await screen.findByRole("navigation", { name: "Menu principal" });
  });
});

describe("Produtos e Categorias e Quartos em Cadastros", () => {
  test("Categorias e Quartos é o segundo item de Cadastros e abre a tela real", async () => {
    instalarApiFalsa({ "GET /api/produtos": [], "GET /api/categorias": [], "GET /api/quartos": [], "GET /api/tarifas/tabelas-base": [] });
    const u = userEvent.setup();
    renderizar(<AppRotas />, { rota: "/cadastros/produtos", usuario: { permissoes: ["cadastros.gerenciar"] } });
    const cadastros = document.getElementById(screen.getByRole("button", { name: "Cadastros" }).getAttribute("aria-controls")!)!;
    expect(nomesLinks(cadastros).slice(0, 2)).toEqual(["Produtos", "Categorias e Quartos"]);
    await u.click(within(cadastros).getByRole("link", { name: "Categorias e Quartos" }));
    expect(await screen.findByRole("region", { name: "Categorias" })).toBeInTheDocument();
    expect(screen.queryByText("Esta tela ainda será construída.")).not.toBeInTheDocument();
  });

  test("sem cadastros.gerenciar a rota nova não abre", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/cadastros/categorias-e-quartos", usuario: { permissoes: ["quartos.situacao"] } });
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
  });

  test.each([
    ["/configuracoes/produtos", /produtos/i],
    ["/configuracoes/categorias", /categorias/i],
  ])("a URL antiga %s redireciona para o novo endereço em Cadastros", async (antiga, regiao) => {
    instalarApiFalsa({ "GET /api/produtos": [], "GET /api/categorias": [], "GET /api/quartos": [], "GET /api/tarifas/tabelas-base": [] });
    renderizar(<><AppRotas /><Sonda /></>, { rota: antiga, usuario: { permissoes: ["cadastros.gerenciar"] } });
    expect(await screen.findByRole("region", { name: regiao })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent(antiga.endsWith("produtos") ? "/cadastros/produtos" : "/cadastros/categorias-e-quartos");
  });

  test("perfil só com cadastros.gerenciar cai em /cadastros/produtos e não abre /configuracoes", async () => {
    instalarApiFalsa({ "GET /api/produtos": [] });
    renderizar(<><AppRotas /><Sonda /></>, { rota: "/configuracoes", usuario: { permissoes: ["cadastros.gerenciar"] } });
    expect(await screen.findByRole("region", { name: "Produtos" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/cadastros/produtos");
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
  });
});

describe("telas em breve", () => {
  test("item novo abre TelaEmBreve com o título e a mensagem", async () => {
    instalarApiFalsa(painel);
    renderizar(<AppRotas />, { rota: "/estoque/fiscal", usuario: { permissoes: tudo } });
    expect(await screen.findByRole("heading", { level: 1, name: "Fiscal" })).toBeInTheDocument();
    expect(screen.getByText("Esta tela ainda será construída.")).toBeInTheDocument();
  });

  test.each(["/estoque/relatorios", "/cadastros/relatorios"])("%s é em breve, em página inteira, com a permissão do grupo", async (rota) => {
    instalarApiFalsa(painel);
    renderizar(<AppRotas />, { rota, usuario: { permissoes: tudo } });
    expect(await screen.findByRole("heading", { level: 1, name: "Relatórios" })).toBeInTheDocument();
    expect(screen.getByText("Esta tela ainda será construída.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Relatórios de Financeiro/Estoque/Cadastros exigem a permissão do grupo", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/cadastros/relatorios", usuario: { permissoes: ["quartos.situacao"] } });
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
  });

  test("Relatórios também é em breve", async () => {
    instalarApiFalsa(painel);
    renderizar(<AppRotas />, { rota: "/relatorios", usuario: { permissoes: ["reservas.gerenciar"] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Relatórios" })).toBeInTheDocument();
  });

  test("a mesma permissão do item protege a rota", async () => {
    instalarApiFalsa({ "GET /api/governanca": [] });
    renderizar(<AppRotas />, { rota: "/estoque/fiscal", usuario: { permissoes: ["quartos.situacao"] } });
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
    expect(screen.queryByText("Esta tela ainda será construída.")).not.toBeInTheDocument();
  });

  test("/cadastros/produtos mostra a tela de produtos real", async () => {
    instalarApiFalsa({ "GET /api/produtos": [] });
    renderizar(<AppRotas />, { rota: "/cadastros/produtos", usuario: { permissoes: ["cadastros.gerenciar"] } });
    expect(await screen.findByRole("region", { name: "Produtos" })).toBeInTheDocument();
    expect(screen.queryByText("Esta tela ainda será construída.")).not.toBeInTheDocument();
  });
});
