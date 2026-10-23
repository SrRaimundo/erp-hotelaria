import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { UsuarioSessao } from "../../src/api/tipos";
import { useSessao } from "../../src/auth/SessaoProvider";
import { AppRotas } from "../../src/rotas";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const recepcao: UsuarioSessao = {
  id: "u1",
  nome: "Maria Recepção",
  perfil: "recepcao",
  permissoes: ["reservas.gerenciar", "caixa.operar", "quartos.situacao"],
  trocarSenha: false,
  limiteDesconto: 5,
};
const admin: UsuarioSessao = { ...recepcao, id: "u0", nome: "Admin", perfil: "admin", trocarSenha: true };
const governanca: UsuarioSessao = { ...recepcao, id: "u2", nome: "Gil", perfil: "governanca", permissoes: ["quartos.situacao"] };

function Sonda() {
  const l = useLocation();
  return <output data-testid="local">{l.pathname + l.search}</output>;
}
function telaCompleta(rota: string, semSessao = true, usuario?: Partial<UsuarioSessao>) {
  return renderizar(
    <>
      <AppRotas />
      <Sonda />
    </>,
    { rota, semSessao, usuario },
  );
}
async function preencherLogin(u: ReturnType<typeof userEvent.setup>, login = "maria", senha = "segredo1") {
  await u.type(screen.getByLabelText("Login"), login);
  await u.type(screen.getByLabelText("Senha"), senha);
  await u.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("login e sessão", () => {
  test("login com sucesso leva à tela Hoje", async () => {
    instalarApiFalsa({ "POST /api/sessoes": { __status: 201, token: "tk1", usuario: recepcao } });
    const u = userEvent.setup();
    telaCompleta("/login");
    await preencherLogin(u);
    expect(await screen.findByRole("heading", { name: "Hoje" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/$/);
    expect(chamadas[0]).toMatchObject({ metodo: "POST", caminho: "/api/sessoes", corpo: { login: "maria", senha: "segredo1" } });
    expect(localStorage.getItem("erp.token")).toBe("tk1");
    expect(JSON.parse(localStorage.getItem("erp.usuario")!)).toMatchObject({ id: "u1" });
  });

  test("login inválido mostra a mensagem do servidor", async () => {
    instalarApiFalsa({ "POST /api/sessoes": { __status: 422, codigo: "CREDENCIAIS_INVALIDAS", mensagem: "Login ou senha incorretos." } });
    const u = userEvent.setup();
    telaCompleta("/login");
    await preencherLogin(u);
    expect(await screen.findByRole("alert")).toHaveTextContent("Login ou senha incorretos.");
    expect(screen.getByTestId("local")).toHaveTextContent("/login");
    expect(localStorage.getItem("erp.token")).toBeNull();
  });

  test("admin com trocarSenha é obrigado a trocar antes de entrar", async () => {
    instalarApiFalsa({
      "POST /api/sessoes": { __status: 201, token: "tk0", usuario: admin },
      "PUT /api/usuarios/me/senha": { __status: 204 },
    });
    const u = userEvent.setup();
    telaCompleta("/login");
    await preencherLogin(u, "admin", "admin123");
    expect(await screen.findByRole("heading", { name: "Trocar senha" })).toBeInTheDocument();

    await u.type(screen.getByLabelText("Senha atual"), "admin123");
    await u.type(screen.getByLabelText("Nova senha"), "abc");
    await u.type(screen.getByLabelText("Confirmar nova senha"), "abc");
    await u.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A nova senha deve ter pelo menos 6 caracteres.");

    await u.clear(screen.getByLabelText("Nova senha"));
    await u.clear(screen.getByLabelText("Confirmar nova senha"));
    await u.type(screen.getByLabelText("Nova senha"), "nova-senha");
    await u.type(screen.getByLabelText("Confirmar nova senha"), "outra-coisa");
    await u.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A confirmação não confere com a nova senha.");
    expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(0);

    await u.clear(screen.getByLabelText("Confirmar nova senha"));
    await u.type(screen.getByLabelText("Confirmar nova senha"), "nova-senha");
    await u.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("heading", { name: "Hoje" })).toBeInTheDocument();
    expect(chamadas.at(-1)).toMatchObject({
      metodo: "PUT",
      caminho: "/api/usuarios/me/senha",
      corpo: { senhaAtual: "admin123", novaSenha: "nova-senha" },
    });
    expect(JSON.parse(localStorage.getItem("erp.usuario")!)).toMatchObject({ trocarSenha: false });
  });

  test("troca de senha rejeita nova igual à atual e mostra erro do servidor", async () => {
    instalarApiFalsa({
      "PUT /api/usuarios/me/senha": { __status: 422, codigo: "SENHA_ATUAL_INCORRETA", mensagem: "Senha atual incorreta." },
    });
    const u = userEvent.setup();
    telaCompleta("/trocar-senha", false);
    expect(await screen.findByRole("heading", { name: "Trocar senha" })).toBeInTheDocument();
    await u.type(screen.getByLabelText("Senha atual"), "mesma-senha");
    await u.type(screen.getByLabelText("Nova senha"), "mesma-senha");
    await u.type(screen.getByLabelText("Confirmar nova senha"), "mesma-senha");
    await u.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A nova senha deve ser diferente da atual.");

    await u.clear(screen.getByLabelText("Senha atual"));
    await u.type(screen.getByLabelText("Senha atual"), "errada");
    await u.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Senha atual incorreta."));
  });

  test("governança cai direto na tela Governança", async () => {
    instalarApiFalsa({ "POST /api/sessoes": { __status: 201, token: "tk2", usuario: governanca } });
    const u = userEvent.setup();
    telaCompleta("/login");
    await preencherLogin(u, "gil");
    expect(await screen.findByRole("heading", { name: "Governança" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/governanca");
  });

  test("sessão expirada volta ao login e retorna à rota anterior", async () => {
    instalarApiFalsa({ "POST /api/sessoes": { __status: 201, token: "tk3", usuario: recepcao } });
    const u = userEvent.setup();
    telaCompleta("/mapa", false);
    expect(await screen.findByRole("heading", { name: "Mapa" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("erp:sessao-expirada"));
    });
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/login?voltar=%2Fmapa");
    expect(localStorage.getItem("erp.token")).toBeNull();
    expect(localStorage.getItem("erp.usuario")).toBeNull();

    await preencherLogin(u);
    expect(await screen.findByRole("heading", { name: "Mapa" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent(/^\/mapa$/);
  });

  test("sem sessão, rota protegida redireciona para o login com voltar", async () => {
    telaCompleta("/caixa", true);
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByTestId("local")).toHaveTextContent("/login?voltar=%2Fcaixa");
  });

  test("usuário com trocarSenha pendente é levado a /trocar-senha ao abrir rota protegida", async () => {
    telaCompleta("/", false, { trocarSenha: true });
    expect(await screen.findByRole("heading", { name: "Trocar senha" })).toBeInTheDocument();
  });

  test("sair chama DELETE /api/sessoes, ignora o erro, limpa o armazenamento e vai ao login", async () => {
    instalarApiFalsa({ "DELETE /api/sessoes": { __status: 500, codigo: "X", mensagem: "falhou" } });
    function BotaoSair() {
      const { sair, pode } = useSessao();
      return <button onClick={() => void sair()}>Sair {pode("x") ? "com x" : "sem x"}</button>;
    }
    const u = userEvent.setup();
    renderizar(
      <>
        <AppRotas />
        <BotaoSair />
        <Sonda />
      </>,
      { rota: "/mapa" },
    );
    await u.click(screen.getByRole("button", { name: "Sair sem x" }));
    await waitFor(() => expect(screen.getByTestId("local")).toHaveTextContent("/login"));
    expect(chamadas[0]).toMatchObject({ metodo: "DELETE", caminho: "/api/sessoes" });
    expect(localStorage.getItem("erp.token")).toBeNull();
    expect(localStorage.getItem("erp.usuario")).toBeNull();
  });
});
