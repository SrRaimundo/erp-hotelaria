import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useSessao } from "../../src/auth/SessaoProvider";
import { TelaPerfis } from "../../src/telas/configuracoes/TelaPerfis";
import { TelaUsuarios } from "../../src/telas/configuracoes/TelaUsuarios";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const USUARIO = { id: "u1", permissoes: ["config.gerenciar"] };
const MARIA = { id: "u1", nome: "Maria Admin", login: "maria", perfil: "admin", perfilRotulo: "Administrador", ativo: true, ultimoAcesso: "2026-10-29T14:30:00.000Z", trocarSenha: false };
const JOAO = { id: "u2", nome: "João Recepção", login: "joao", perfil: "recepcao", perfilRotulo: "Recepção", ativo: true, ultimoAcesso: null, trocarSenha: true };
const PEDRO = { id: "u3", nome: "Pedro Antigo", login: "pedro", perfil: "recepcao", perfilRotulo: "Recepção", ativo: false, ultimoAcesso: null, trocarSenha: false };

const ADMIN = { nome: "admin", rotulo: "Administrador", padrao: true, limiteDesconto: 100, permissoes: ["config.gerenciar", "reservas.gerenciar"], usuarios: 1 };
const RECEPCAO = { nome: "recepcao", rotulo: "Recepção", padrao: true, limiteDesconto: 10, permissoes: ["reservas.gerenciar", "hospedagem.checkin"], usuarios: 2 };
const GERENTE = { nome: "gerente", rotulo: "Gerente", padrao: false, limiteDesconto: 20, permissoes: ["reservas.gerenciar"], usuarios: 0 };
const PERMISSOES = [
  { permissao: "reservas.gerenciar", descricao: "Criar, alterar e cancelar reservas; ver hóspedes, mapa e painel" },
  { permissao: "hospedagem.checkin", descricao: "Fazer check-in" },
  { permissao: "config.gerenciar", descricao: "Configurar a pousada, usuários, perfis e checklists" },
];

function leiturasUsuarios(extra: Record<string, unknown> = {}) {
  return { "GET /api/usuarios": [MARIA, JOAO, PEDRO], "GET /api/perfis": [ADMIN, RECEPCAO, GERENTE], ...extra };
}
function leiturasPerfis(extra: Record<string, unknown> = {}) {
  return { "GET /api/perfis": [ADMIN, RECEPCAO, GERENTE], "GET /api/permissoes": PERMISSOES, ...extra };
}

async function abrirEdicao(nome: string) {
  const u = userEvent.setup();
  const linha = (await screen.findByText(nome)).closest("tr")!;
  await u.click(within(linha).getByRole("button", { name: "Editar" }));
  return { u, painel: await screen.findByRole("dialog", { name: /Editar/ }) };
}

describe("tela Usuários", () => {
  test("lista nome, login, perfil, situação e último acesso", async () => {
    instalarApiFalsa(leiturasUsuarios());
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const maria = (await screen.findByText("Maria Admin")).closest("tr")!;
    expect(within(maria).getByText("maria")).toBeInTheDocument();
    expect(within(maria).getByText("Administrador")).toBeInTheDocument();
    expect(within(maria).getByText("Ativo")).toBeInTheDocument();
    expect(within(maria).getByText(/^\d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
    const joao = screen.getByText("João Recepção").closest("tr")!;
    expect(within(joao).getByText("nunca")).toBeInTheDocument();
    // desativados ficam ocultos até pedir
    expect(screen.queryByText("Pedro Antigo")).not.toBeInTheDocument();
  });

  test("redefinir senha mostra a senha temporária uma vez", async () => {
    instalarApiFalsa(leiturasUsuarios({ "POST /api/usuarios/u2/redefinir-senha": { senhaTemporaria: "Ab3dEf7h" } }));
    const { cliente } = renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const { u, painel } = await abrirEdicao("João Recepção");
    await u.click(within(painel).getByRole("button", { name: "Redefinir senha" }));
    const janela = await screen.findByRole("dialog", { name: "Senha temporária" });
    expect(within(janela).getByText("Ab3dEf7h")).toBeInTheDocument();
    expect(within(janela).getByText("Anote agora; ela não será mostrada de novo.")).toBeInTheDocument();
    expect(chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/api/usuarios/u2/redefinir-senha")).toHaveLength(1);
    // não fica guardada no cache de consultas
    expect(JSON.stringify(cliente.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("Ab3dEf7h");
    await u.click(within(janela).getByRole("button", { name: "Fechar" }));
    await vi.waitFor(() => expect(cliente.getMutationCache().getAll()).toHaveLength(0));
    expect(screen.queryByText("Ab3dEf7h")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Senha temporária" })).not.toBeInTheDocument();
  });

  test("não mostra desativar para o próprio usuário", async () => {
    instalarApiFalsa(leiturasUsuarios());
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const proprio = await abrirEdicao("Maria Admin");
    expect(within(proprio.painel).queryByRole("button", { name: "Desativar" })).not.toBeInTheDocument();
    expect(within(proprio.painel).getByLabelText("Perfil")).toBeDisabled();
    expect(within(proprio.painel).getByText("Você não pode mudar o seu próprio perfil.")).toBeInTheDocument();
    await proprio.u.click(within(proprio.painel).getByRole("button", { name: "Fechar" }));
    const outro = await abrirEdicao("João Recepção");
    expect(within(outro.painel).getByRole("button", { name: "Desativar" })).toBeInTheDocument();
    expect(within(outro.painel).getByLabelText("Perfil")).toBeEnabled();
  });

  test("desativar mostra o erro do servidor junto da ação", async () => {
    instalarApiFalsa(
      leiturasUsuarios({ "POST /api/usuarios/u2/desativar": { __status: 422, codigo: "ULTIMO_ADMINISTRADOR", mensagem: "Deve restar ao menos um administrador ativo." } }),
    );
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const { u, painel } = await abrirEdicao("João Recepção");
    await u.click(within(painel).getByRole("button", { name: "Desativar" }));
    expect(await within(painel).findByRole("alert")).toHaveTextContent("Deve restar ao menos um administrador ativo.");
  });

  test("cria usuário com perfil e senha inicial; salvar desligado com o motivo dito", async () => {
    instalarApiFalsa(leiturasUsuarios({ "POST /api/usuarios": { __status: 201, id: "u9" } }));
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "+ Novo" }));
    const painel = await screen.findByRole("dialog", { name: /Novo/ });
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(painel).getByText("Informe o nome.")).toBeInTheDocument();
    await u.type(within(painel).getByLabelText("Nome"), "Ana Nova");
    await u.type(within(painel).getByLabelText("Login"), "ana");
    await u.type(within(painel).getByLabelText("Senha inicial"), "segredo1");
    await u.selectOptions(await within(painel).findByLabelText("Perfil"), "Recepção");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST" && c.caminho === "/api/usuarios")).toBeDefined());
    expect(chamadas.find((c) => c.caminho === "/api/usuarios" && c.metodo === "POST")!.corpo).toEqual({ nome: "Ana Nova", login: "ana", senha: "segredo1", perfil: "recepcao" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("edita nome e perfil de outro usuário", async () => {
    instalarApiFalsa(leiturasUsuarios({ "PUT /api/usuarios/u2": JOAO }));
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const { u, painel } = await abrirEdicao("João Recepção");
    await u.clear(within(painel).getByLabelText("Nome"));
    await u.type(within(painel).getByLabelText("Nome"), "João Silva");
    await u.selectOptions(within(painel).getByLabelText("Perfil"), "Gerente");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({ caminho: "/api/usuarios/u2", corpo: { nome: "João Silva", perfil: "gerente" } });
  });
});

describe("tela Usuários (reativar)", () => {
  test("Reativar um usuário desativado", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasUsuarios({ "POST /api/usuarios/u3/reativar": { __status: 204 } }));
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    await u.click(await screen.findByLabelText("Mostrar desativados"));
    const linha = (await screen.findByText("Pedro Antigo")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    await u.click(within(painel).getByRole("button", { name: "Reativar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST" && c.caminho === "/api/usuarios/u3/reativar")).toBeDefined());
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("editar o próprio nome relê a sessão", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasUsuarios({ "PUT /api/usuarios/u1": MARIA, "GET /api/sessoes/atual": { id: "u1", nome: "Maria Nova", perfil: "admin", permissoes: ["config.gerenciar"], trocarSenha: false, limiteDesconto: 100 } }));
    renderizar(<TelaUsuarios />, { usuario: USUARIO });
    const { painel } = await abrirEdicao("Maria Admin");
    await u.clear(within(painel).getByLabelText("Nome"));
    await u.type(within(painel).getByLabelText("Nome"), "Maria Nova");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("erp.usuario")!).nome).toBe("Maria Nova"));
  });
});

describe("tela Perfis", () => {
  test("lista rótulo, padrão e número de usuários", async () => {
    instalarApiFalsa(leiturasPerfis());
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    const gerente = (await screen.findByText("Gerente")).closest("tr")!;
    expect(within(gerente).getByText("Personalizado")).toBeInTheDocument();
    const recepcao = screen.getByText("Recepção").closest("tr")!;
    expect(within(recepcao).getByText("Padrão")).toBeInTheDocument();
    expect(within(recepcao).getByText("2")).toBeInTheDocument();
  });

  test("criar perfil copiando permissões e marcar/desmarcar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasPerfis({ "POST /api/perfis": { __status: 201, ...GERENTE, nome: "chefe", rotulo: "Chefe" }, "PUT /api/perfis/gerente": GERENTE }));
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    await u.click(await screen.findByRole("button", { name: "+ Novo perfil" }));
    const novo = await screen.findByRole("dialog", { name: /Novo/ });
    expect(within(novo).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(novo).getByText("Informe o nome do perfil.")).toBeInTheDocument();
    expect(within(novo).getByText("Escolha o perfil de onde copiar as permissões.")).toBeInTheDocument();
    await u.type(within(novo).getByLabelText("Nome do perfil"), "Chefe");
    await u.selectOptions(within(novo).getByLabelText("Copiar permissões de"), "Recepção");
    await u.click(within(novo).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "POST" && c.caminho === "/api/perfis")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "POST" && c.caminho === "/api/perfis")!.corpo).toEqual({ rotulo: "Chefe", copiarDe: "recepcao" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // marcar e desmarcar permissões num perfil personalizado; limite em % é enviado como inteiro
    const linha = screen.getByText("Gerente").closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    const reservas = await within(painel).findByRole("checkbox", { name: /Criar, alterar e cancelar reservas/ });
    const checkin = within(painel).getByRole("checkbox", { name: "Fazer check-in" });
    expect(reservas).toBeChecked();
    expect(checkin).not.toBeChecked();
    await u.click(reservas);
    await u.click(checkin);
    await u.clear(within(painel).getByLabelText("Limite de desconto (%)"));
    await u.type(within(painel).getByLabelText("Limite de desconto (%)"), "15");
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({
      caminho: "/api/perfis/gerente",
      corpo: { rotulo: "Gerente", limiteDesconto: 15, permissoes: ["hospedagem.checkin"] },
    });
  });

  test("erro ULTIMO_ADMINISTRADOR aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(
      leiturasPerfis({ "PUT /api/perfis/recepcao": { __status: 422, codigo: "ULTIMO_ADMINISTRADOR", mensagem: "Deve restar ao menos um administrador ativo, com permissão de configurar a pousada." } }),
    );
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    const linha = (await screen.findByText("Recepção")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    await u.click(await within(painel).findByRole("checkbox", { name: /Configurar a pousada/ }));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    const alerta = await within(painel).findByRole("alert");
    expect(alerta).toHaveTextContent("Deve restar ao menos um administrador ativo");
    expect(alerta.closest("form")).toBe(within(painel).getByRole("button", { name: "Salvar" }).closest("form"));
  });

  test("Administrador mantém config.gerenciar marcada e desabilitada, com a explicação", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasPerfis());
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    const linha = (await screen.findByText("Administrador")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    const config = await within(painel).findByRole("checkbox", { name: /Configurar a pousada/ });
    expect(config).toBeChecked();
    expect(config).toBeDisabled();
    expect(within(painel).getByText("O perfil Administrador precisa manter esta permissão.")).toBeInTheDocument();
  });

  test("Excluir só para personalizado sem usuários; os demais mostram o motivo", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasPerfis({ "DELETE /api/perfis/gerente": { __status: 204 } }));
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    await screen.findByText("Gerente");

    await u.click(within(screen.getByText("Recepção").closest("tr")!).getByRole("button", { name: "Editar" }));
    let painel = await screen.findByRole("dialog", { name: /Editar/ });
    expect(within(painel).getByRole("button", { name: "Excluir" })).toBeDisabled();
    expect(within(painel).getByText("Perfis padrão não podem ser excluídos.")).toBeInTheDocument();
    await u.click(within(painel).getByRole("button", { name: "Fechar" }));

    await u.click(within(screen.getByText("Gerente").closest("tr")!).getByRole("button", { name: "Editar" }));
    painel = await screen.findByRole("dialog", { name: /Editar/ });
    await u.click(within(painel).getByRole("button", { name: "Excluir" }));
    const confirmacao = await screen.findByRole("dialog", { name: "Excluir perfil Gerente?" });
    expect(chamadas.find((c) => c.metodo === "DELETE")).toBeUndefined();
    await u.click(within(confirmacao).getByRole("button", { name: "Confirmar exclusão" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "DELETE" && c.caminho === "/api/perfis/gerente")).toBeDefined());
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("PERFIL_ADMIN_PROTEGIDO aparece junto do salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(
      leiturasPerfis({ "PUT /api/perfis/admin": { __status: 422, codigo: "PERFIL_ADMIN_PROTEGIDO", mensagem: "O perfil Administrador precisa manter a permissão de configurar a pousada." } }),
    );
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    const linha = (await screen.findByText("Administrador")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    await u.click(await within(painel).findByRole("checkbox", { name: /Criar, alterar e cancelar reservas/ }));
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    const alerta = await within(painel).findByRole("alert");
    expect(alerta).toHaveTextContent("O perfil Administrador precisa manter");
    expect(alerta.closest("form")).toBe(within(painel).getByRole("button", { name: "Salvar" }).closest("form"));
  });

  test.each(["101", "1.5", "", "-3"])("limite de desconto inválido (%j) desliga o salvar e diz o motivo", async (valor) => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasPerfis());
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    const linha = (await screen.findByText("Gerente")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    const campo = await within(painel).findByLabelText("Limite de desconto (%)");
    await u.clear(campo);
    if (valor) await u.type(campo, valor);
    expect(within(painel).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(painel).getByText("Limite de desconto: informe um número inteiro de 0 a 100.")).toBeInTheDocument();
  });

  test("a dica do Administrador está ligada à permissão protegida", async () => {
    const u = userEvent.setup();
    instalarApiFalsa(leiturasPerfis());
    renderizar(<TelaPerfis />, { usuario: USUARIO });
    const linha = (await screen.findByText("Administrador")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const config = await screen.findByRole("checkbox", { name: /Configurar a pousada/ });
    expect(config).toHaveAccessibleDescription("O perfil Administrador precisa manter esta permissão.");
  });

  test("editar o próprio perfil atualiza as permissões da sessão sem novo login", async () => {
    const u = userEvent.setup();
    const novo = { id: "u1", nome: "Maria", perfil: "recepcao", permissoes: ["hospedagem.checkin"], trocarSenha: false, limiteDesconto: 10 };
    instalarApiFalsa(leiturasPerfis({ "PUT /api/perfis/recepcao": RECEPCAO, "GET /api/sessoes/atual": novo }));
    function Sonda() {
      const { pode } = useSessao();
      return <p>{pode("reservas.gerenciar") ? "com reservas" : "sem reservas"}</p>;
    }
    renderizar(
      <>
        <Sonda />
        <TelaPerfis />
      </>,
      { usuario: { id: "u1", perfil: "recepcao", permissoes: ["config.gerenciar", "reservas.gerenciar"] } },
    );
    // a releitura do início do app já traz as permissões atuais
    expect(await screen.findByText("sem reservas")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("erp.usuario")!).permissoes).toEqual(["hospedagem.checkin"]);
    const linha = (await screen.findByText("Recepção")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Editar" }));
    const painel = await screen.findByRole("dialog", { name: /Editar/ });
    await within(painel).findByRole("checkbox", { name: "Fazer check-in" });
    const antes = chamadas.filter((c) => c.caminho === "/api/sessoes/atual").length;
    await u.click(within(painel).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.filter((c) => c.caminho === "/api/sessoes/atual").length).toBe(antes + 1));
  });
});
