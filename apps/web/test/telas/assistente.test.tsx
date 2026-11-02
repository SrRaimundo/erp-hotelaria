import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppRotas } from "../../src/rotas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { criarPainel } from "../fixtures/painel";

afterEach(() => vi.unstubAllGlobals());

const ADMIN = { id: "u1", nome: "Admin", perfil: "admin", permissoes: ["config.gerenciar", "cadastros.gerenciar", "reservas.gerenciar"] };
const CONFIG = {
  razaoSocial: "Pousada Sol Ltda", cnpj: "", endereco: "", fuso: "America/Sao_Paulo", horaCheckin: "14:00", horaCheckout: "12:00", viradaDia: "04:00",
  arredondamento: "nenhum", sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 },
  earlyCheckin: { tipo: "fixo", valor: 5000 }, lateCheckout: { tipo: "fixo", valor: 5000 }, idadeAdulto: 12, limiteCriancasGratis: 1,
  camareiraLancaFrigobar: false, assistenteEquipePulado: false,
};
const PERFIS = [
  { nome: "admin", rotulo: "Administrador", padrao: true, limiteDesconto: 100, permissoes: [], usuarios: 1 },
  { nome: "recepcao", rotulo: "Recepção", padrao: true, limiteDesconto: 10, permissoes: [], usuarios: 0 },
  { nome: "governanca", rotulo: "Governança", padrao: true, limiteDesconto: 0, permissoes: [], usuarios: 0 },
];
const VAZIO = { pousada: true, quartos: false, equipe: false, categorias: [] };
const COM_QUARTOS = { pousada: true, quartos: true, equipe: false, categorias: [{ id: "c1", nome: "Standard", quartos: ["101", "102"] }] };
const PAINEL = criarPainel({ atencao: [] });

function Sonda() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname}</output>;
}
const telaApp = (rota: string, opcoes: Parameters<typeof renderizar>[1] = {}) =>
  renderizar(<><AppRotas /><Sonda /></>, { rota, usuario: ADMIN, ...opcoes });

async function preencherCategoria(u: ReturnType<typeof userEvent.setup>, grupo: HTMLElement, v: { nome: string; de: string; ate: string; bloco?: string }) {
  await u.type(within(grupo).getByLabelText("Nome da categoria"), v.nome);
  await u.clear(within(grupo).getByLabelText("Máximo de adultos"));
  await u.type(within(grupo).getByLabelText("Máximo de adultos"), "3");
  await u.type(within(grupo).getByLabelText("Diária para 1 adulto"), "200");
  await u.type(within(grupo).getByLabelText("Diária para 2 adultos"), "300,50");
  await u.type(within(grupo).getByLabelText("Diária para 3 adultos"), "400");
  await u.type(within(grupo).getByLabelText("Adulto extra"), "80");
  await u.type(within(grupo).getByLabelText("Quarto inicial"), v.de);
  await u.type(within(grupo).getByLabelText("Quarto final"), v.ate);
  if (v.bloco) await u.type(within(grupo).getByLabelText("Bloco"), v.bloco);
}

const USUARIO_LOGIN = { ...ADMIN, limiteDesconto: 100, trocarSenha: false };
async function entrarPeloLogin(u: ReturnType<typeof userEvent.setup>, usuario: Record<string, unknown> = USUARIO_LOGIN) {
  await u.type(await screen.findByLabelText("Login"), "admin");
  await u.type(screen.getByLabelText("Senha"), "admin123");
  await u.click(screen.getByRole("button", { name: "Entrar" }));
  return usuario;
}

async function trocarSenha(u: ReturnType<typeof userEvent.setup>) {
  await u.type(await screen.findByLabelText("Senha atual"), "admin123");
  await u.type(screen.getByLabelText("Nova senha"), "nova-senha");
  await u.type(screen.getByLabelText("Confirmar nova senha"), "nova-senha");
  await u.click(screen.getByRole("button", { name: "Salvar nova senha" }));
}

describe("assistente de primeira configuração", () => {
  test("R10: login normal de admin em base sem quartos leva ao assistente", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk", usuario: USUARIO_LOGIN },
      "GET /api/painel": PAINEL,
      "GET /api/assistente": { pousada: false, quartos: false, equipe: false, categorias: [] },
      "GET /api/config": { ...CONFIG, razaoSocial: "" },
    });
    const u = userEvent.setup();
    telaApp("/login", { semSessao: true });
    await entrarPeloLogin(u);
    expect(await screen.findByRole("heading", { name: "Primeira configuração" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/configuracoes/assistente");
    expect(await screen.findByRole("listitem", { current: "step" })).toHaveTextContent("1 Pousada");
  });

  test("login com troca de senha obrigatória também chega ao assistente depois da troca", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk", usuario: { ...USUARIO_LOGIN, trocarSenha: true } },
      "PUT /api/usuarios/me/senha": { __status: 204 },
      "GET /api/painel": PAINEL,
      "GET /api/assistente": { pousada: false, quartos: false, equipe: false, categorias: [] },
      "GET /api/config": { ...CONFIG, razaoSocial: "" },
    });
    const u = userEvent.setup();
    telaApp("/login", { semSessao: true });
    await entrarPeloLogin(u);
    await trocarSenha(u);
    expect(await screen.findByRole("heading", { name: "Primeira configuração" })).toBeInTheDocument();
  });

  test("a oferta vale uma vez por login: Sair do assistente vai ao destino normal e não a repete", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk", usuario: USUARIO_LOGIN },
      "DELETE /api/sessoes": { __status: 204 },
      "GET /api/painel": PAINEL,
      "GET /api/assistente": VAZIO,
      "GET /api/config": CONFIG,
    });
    const u = userEvent.setup();
    telaApp("/login", { semSessao: true });
    await entrarPeloLogin(u);
    await screen.findByRole("heading", { name: "Primeira configuração" });
    const antes = chamadas.filter((c) => c.caminho === "/api/assistente").length;
    await u.click(await screen.findByRole("button", { name: "Sair do assistente" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/));
    await screen.findByText(/ocupação hoje/);
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/);
    expect(chamadas.filter((c) => c.caminho === "/api/assistente")).toHaveLength(antes);
  });

  test("com quartos já criados o login segue o destino normal", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk", usuario: USUARIO_LOGIN },
      "GET /api/painel": PAINEL,
      "GET /api/assistente": { ...VAZIO, quartos: true },
      "GET /api/config": CONFIG,
    });
    const u = userEvent.setup();
    telaApp("/login", { semSessao: true });
    await entrarPeloLogin(u);
    await screen.findByText(/ocupação hoje/);
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/);
  });

  test("abre no primeiro passo incompleto; o passo de quartos envia as categorias e avança", async () => {
    let enviado: unknown;
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": VAZIO,
      "POST /api/assistente/quartos": (corpo: unknown) => {
        enviado = corpo;
        return { __status: 201, ...COM_QUARTOS };
      },
      "GET /api/perfis": PERFIS,
    });
    const u = userEvent.setup();
    const { cliente } = telaApp("/configuracoes/assistente");
    expect(await screen.findByRole("heading", { name: "Categorias e quartos" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("2 Quartos");
    const criar = screen.getByRole("button", { name: "Criar categorias e quartos" });
    expect(criar).toBeDisabled();
    expect(screen.getByText("Informe o nome da categoria.")).toBeInTheDocument();
    await preencherCategoria(u, screen.getByRole("group", { name: "Categoria 1" }), { nome: "Standard", de: "101", ate: "102", bloco: "A" });
    expect(criar).toBeEnabled();
    const invalidadas: string[] = [];
    const original = cliente.invalidateQueries.bind(cliente);
    cliente.invalidateQueries = ((f?: { queryKey?: readonly unknown[] }) => {
      invalidadas.push(String(f?.queryKey?.[0]));
      return original(f as never);
    }) as typeof cliente.invalidateQueries;
    await u.click(criar);
    expect(await screen.findByRole("heading", { name: "Equipe" })).toBeInTheDocument();
    expect(enviado).toEqual({
      categorias: [{ nome: "Standard", maxAdultos: 3, maxCriancas: 0, porAdultos: { 1: 20000, 2: 30050, 3: 40000 }, adultoExtra: 8000, de: 101, ate: 102, bloco: "A" }],
    });
    expect(invalidadas).toEqual(expect.arrayContaining(["categorias", "quartos", "tarifas", "mapa"]));
  });

  test("numeração duplicada destaca os números e não avança", async () => {
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": VAZIO,
      "POST /api/assistente/quartos": { __status: 422, codigo: "NUMERO_QUARTO_DUPLICADO", mensagem: "Os números 102, 103 estão em mais de uma categoria. Nada foi criado.", detalhes: { numeros: ["102", "103"] } },
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Categorias e quartos" });
    await preencherCategoria(u, screen.getByRole("group", { name: "Categoria 1" }), { nome: "Standard", de: "101", ate: "103" });
    await u.click(screen.getByRole("button", { name: "Criar categorias e quartos" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Os números 102, 103 estão em mais de uma categoria. Nada foi criado.");
    expect(alerta).toHaveTextContent("Números em conflito: 102, 103");
    expect(screen.getByRole("group", { name: "Categoria 1" })).toHaveClass("assistente__linha--conflito");
    expect(screen.getByRole("heading", { name: "Categorias e quartos" })).toBeInTheDocument();
  });

  test("Review Focus 5: com quartos existentes, o passo 2 só mostra e não reenvia", async () => {
    instalarApiFalsa({ "GET /api/painel": PAINEL, "GET /api/assistente": COM_QUARTOS, "GET /api/perfis": PERFIS });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Equipe" });
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("heading", { name: "Categorias e quartos" })).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("101, 102")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome da categoria")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar categorias e quartos" })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByRole("heading", { name: "Equipe" })).toBeInTheDocument();
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(0);
  });

  test("equipe: cria em sequência, mostra o erro da linha e não recria as já criadas ao tentar de novo", async () => {
    let tentativaMaria = 0;
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": COM_QUARTOS,
      "GET /api/perfis": PERFIS,
      "GET /api/usuarios": [],
      "POST /api/usuarios": (c: { login: string }) => {
        if (c.login === "maria") {
          tentativaMaria += 1;
          if (tentativaMaria === 1) return { __status: 422, codigo: "LOGIN_DUPLICADO", mensagem: "Já existe um usuário com este login." };
        }
        return { __status: 201, id: `id-${c.login}` };
      },
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Equipe" });
    const preencher = async (g: HTMLElement, nome: string, login: string) => {
      await u.type(within(g).getByLabelText("Nome"), nome);
      await u.type(within(g).getByLabelText("Login"), login);
      await u.type(within(g).getByLabelText("Senha inicial"), "senha123");
    };
    await preencher(screen.getByRole("group", { name: "Usuário 1" }), "João", "joao");
    await u.click(screen.getByRole("button", { name: "+ Outro" }));
    await preencher(screen.getByRole("group", { name: "Usuário 2" }), "Maria", "maria");
    await u.click(screen.getByRole("button", { name: "Salvar e avançar" }));
    expect(await within(screen.getByRole("group", { name: "Usuário 2" })).findByRole("alert")).toHaveTextContent("Já existe um usuário com este login.");
    expect(within(screen.getByRole("group", { name: "Usuário 1" })).getByText("Criado")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Equipe" })).toBeInTheDocument();
    const posts = () => chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/usuarios");
    expect(posts()).toHaveLength(2);
    expect(posts()[0]!.corpo).toEqual({ nome: "João", login: "joao", senha: "senha123", perfil: "recepcao" });

    await u.click(screen.getByRole("button", { name: "Salvar e avançar" }));
    expect(await screen.findByRole("heading", { name: "Pronto" })).toBeInTheDocument();
    expect(posts()).toHaveLength(3);
    expect(posts().filter((c) => (c.corpo as { login: string }).login === "joao")).toHaveLength(1);
  });

  test("pular equipe", async () => {
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": COM_QUARTOS,
      "GET /api/perfis": PERFIS,
      "GET /api/usuarios": [{ id: "u1", ativo: true }],
      "POST /api/assistente/pular-equipe": { ...COM_QUARTOS, equipe: true },
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Equipe" });
    await u.click(screen.getByRole("button", { name: "Pular" }));
    expect(await screen.findByRole("heading", { name: "Pronto" })).toBeInTheDocument();
    expect(chamadas.some((c) => c.metodo === "POST" && c.caminho === "/api/assistente/pular-equipe")).toBe(true);
    expect(await screen.findByText("1 categoria · 2 quartos · 1 usuário ativo")).toBeInTheDocument();
  });

  test("passo Pronto leva às regras da pousada", async () => {
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": { ...COM_QUARTOS, equipe: true },
      "GET /api/usuarios": [],
      "GET /api/config": CONFIG,
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Pronto" });
    await u.click(screen.getByRole("button", { name: "Ajustar regras da pousada" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/configuracoes/pousada"));
    expect(await screen.findByRole("heading", { name: "Pousada" })).toBeInTheDocument();
  });

  test("passo Pronto leva ao mapa", async () => {
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": { ...COM_QUARTOS, equipe: true },
      "GET /api/usuarios": [],
      "GET /api/mapa": { quartos: [], barras: [] },
      "GET /api/categorias": [],
      "GET /api/config": CONFIG,
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Pronto" });
    await u.click(screen.getByRole("button", { name: "Ir para o mapa" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/mapa"));
  });

  test("Sair do assistente leva ao destino normal e o submenu tem o item", async () => {
    instalarApiFalsa({ "GET /api/assistente": VAZIO, "GET /api/painel": PAINEL, "GET /api/config": CONFIG });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Categorias e quartos" });
    expect(within(screen.getByRole("navigation", { name: "Configurações" })).getByRole("link", { name: "Primeira configuração" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Sair do assistente" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/));
  });
});

describe("assistente: ajustes da revisão", () => {
  test("categoria duplicada aparece junto do campo de nome", async () => {
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": VAZIO,
      "POST /api/assistente/quartos": { __status: 422, codigo: "CATEGORIA_DUPLICADA", mensagem: 'Já existe uma categoria chamada "Standard".', detalhes: { nome: "Standard" } },
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Categorias e quartos" });
    await preencherCategoria(u, screen.getByRole("group", { name: "Categoria 1" }), { nome: "standard", de: "101", ate: "102" });
    await u.click(screen.getByRole("button", { name: "Criar categorias e quartos" }));
    const grupo = screen.getByRole("group", { name: "Categoria 1" });
    expect(await within(grupo).findByRole("alert")).toHaveTextContent('Já existe uma categoria chamada "Standard".');
    expect(within(grupo).getByLabelText("Nome da categoria")).toHaveAttribute("aria-invalid", "true");
  });

  test("Voltar e Avançar preservam as linhas da equipe, inclusive as já criadas", async () => {
    instalarApiFalsa({
      "GET /api/painel": PAINEL,
      "GET /api/assistente": COM_QUARTOS,
      "GET /api/perfis": PERFIS,
      "GET /api/usuarios": [],
      "POST /api/usuarios": { __status: 201, id: "x" },
    });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    await screen.findByRole("heading", { name: "Equipe" });
    const g1 = screen.getByRole("group", { name: "Usuário 1" });
    await u.type(within(g1).getByLabelText("Nome"), "João");
    await u.type(within(g1).getByLabelText("Login"), "joao");
    await u.type(within(g1).getByLabelText("Senha inicial"), "senha123");
    await u.click(screen.getByRole("button", { name: "+ Outro" }));
    await u.type(within(screen.getByRole("group", { name: "Usuário 2" })).getByLabelText("Nome"), "Ana");
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    await screen.findByRole("heading", { name: "Categorias e quartos" });
    await u.click(screen.getByRole("button", { name: "Avançar" }));
    const volta1 = await screen.findByRole("group", { name: "Usuário 1" });
    expect(within(volta1).getByLabelText("Nome")).toHaveValue("João");
    expect(within(screen.getByRole("group", { name: "Usuário 2" })).getByLabelText("Nome")).toHaveValue("Ana");
    // linha criada continua travada depois de ir e voltar
    await u.clear(within(screen.getByRole("group", { name: "Usuário 2" })).getByLabelText("Nome"));
    await u.click(screen.getByRole("button", { name: "Salvar e avançar" }));
    await screen.findByRole("heading", { name: "Pronto" });
    await u.click(screen.getByRole("button", { name: "Voltar" }));
    const criada = await screen.findByRole("group", { name: "Usuário 1" });
    expect(within(criada).getByText("Criado")).toBeInTheDocument();
    expect(within(criada).getByLabelText("Nome")).toBeDisabled();
  });

  test("/configuracoes leva ao assistente enquanto não há quartos, e a Pousada depois", async () => {
    instalarApiFalsa({ "GET /api/painel": PAINEL, "GET /api/assistente": VAZIO, "GET /api/config": CONFIG });
    const { unmount } = telaApp("/configuracoes");
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/configuracoes/assistente"));
    await screen.findByRole("heading", { name: "Primeira configuração" });
    unmount();
    instalarApiFalsa({ "GET /api/painel": PAINEL, "GET /api/assistente": COM_QUARTOS, "GET /api/config": CONFIG });
    telaApp("/configuracoes");
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/configuracoes/pousada"));
    await screen.findByRole("heading", { name: "Pousada" });
  });

  test("/configuracoes sem config.gerenciar volta à tela inicial e não consulta o assistente", async () => {
    instalarApiFalsa({ "GET /api/painel": PAINEL });
    telaApp("/configuracoes", { usuario: { permissoes: ["cadastros.gerenciar", "reservas.gerenciar"] } });
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/));
    expect(chamadas.some((c) => c.caminho === "/api/assistente")).toBe(false);
  });

  test("login sem config.gerenciar não consulta o assistente", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk", usuario: { ...USUARIO_LOGIN, permissoes: ["reservas.gerenciar"] } },
      "GET /api/painel": PAINEL,
      "GET /api/config": CONFIG,
    });
    const u = userEvent.setup();
    telaApp("/login", { semSessao: true });
    await entrarPeloLogin(u);
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/));
    await screen.findByText(/ocupação hoje/);
    expect(chamadas.some((c) => c.caminho === "/api/assistente")).toBe(false);
  });

  test("falha ao consultar o assistente no login segue o destino normal", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk", usuario: USUARIO_LOGIN },
      "GET /api/assistente": { __status: 500, codigo: "ERRO", mensagem: "Falhou." },
      "GET /api/painel": PAINEL,
      "GET /api/config": CONFIG,
    });
    const u = userEvent.setup();
    telaApp("/login", { semSessao: true });
    await entrarPeloLogin(u);
    await screen.findByText(/ocupação hoje/);
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/);
  });

  test("sessão já aberta (recarregar a página) não redireciona ao assistente", async () => {
    instalarApiFalsa({ "GET /api/painel": PAINEL, "GET /api/config": CONFIG });
    telaApp("/");
    await screen.findByText(/ocupação hoje/);
    expect(chamadas.some((c) => c.caminho === "/api/assistente")).toBe(false);
  });

  test("M2: Avançar com edição não salva no passo Pousada avisa e não avança", async () => {
    instalarApiFalsa({ "GET /api/painel": PAINEL, "GET /api/assistente": { ...VAZIO, pousada: false }, "GET /api/config": CONFIG });
    const u = userEvent.setup();
    telaApp("/configuracoes/assistente");
    const dados = await screen.findByRole("region", { name: "Dados" });
    await u.type(within(dados).getByLabelText("CNPJ"), "123");
    await u.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("alterações não salvas em Dados");
    expect(screen.getByRole("heading", { name: "Pousada" })).toBeInTheDocument();
    expect(within(dados).getByLabelText("CNPJ")).toHaveValue("123");
  });
});
