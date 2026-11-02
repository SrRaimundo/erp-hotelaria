import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ExigePermissao } from "../../src/auth/ExigePermissao";
import { MenuLateral } from "../../src/layout/MenuLateral";
import { ListaCadastro } from "../../src/telas/configuracoes/ListaCadastro";
import { LayoutConfiguracoes, PrimeiraConfiguracao } from "../../src/telas/configuracoes/LayoutConfiguracoes";
import { TelaPousada } from "../../src/telas/configuracoes/TelaPousada";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { rotaInicial } from "../../src/auth/SessaoProvider";
import { renderizar, usuarioPadrao } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const CONFIG = {
  nomeEstabelecimento: "Pousada Sol",
  razaoSocial: "Pousada Sol Ltda",
  cnpj: "12.345.678/0001-90",
  endereco: "Rua das Flores, 10",
  fuso: "America/Sao_Paulo",
  horaCheckin: "14:00",
  horaCheckout: "12:00",
  viradaDia: "04:00",
  arredondamento: "nenhum",
  sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 48, toleranciaHoras: 12 },
  earlyCheckin: { tipo: "fixo", valor: 5000 },
  lateCheckout: { tipo: "percentual_diaria", valor: 50 },
  idadeAdulto: 12,
  limiteCriancasGratis: 1,
  camareiraLancaFrigobar: false,
  assistenteEquipePulado: false,
};

function Arvore() {
  return (
    <Routes>
      <Route path="/" element={<p>inicio</p>} />
      <Route path="/configuracoes" element={<ExigePermissao permissao="config.gerenciar"><LayoutConfiguracoes /></ExigePermissao>}>
        <Route index element={<PrimeiraConfiguracao />} />
        <Route path="pousada" element={<p>tela pousada</p>} />
        <Route path="usuarios" element={<p>tela usuarios</p>} />
      </Route>
    </Routes>
  );
}

describe("área Configurações", () => {
  test("engrenagem de Configurações só com config.gerenciar", () => {
    const { unmount } = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["caixa.operar", "quartos.situacao", "cadastros.gerenciar"] } });
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
    unmount();
    renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["caixa.operar", "config.gerenciar"] } });
    const engrenagem = screen.getByRole("link", { name: "Configurações" });
    expect(engrenagem).toHaveAttribute("href", "/configuracoes");
    expect(engrenagem).toHaveAttribute("title", "Configurações");
    // Não é mais um item da lista principal.
    expect(within(screen.getByRole("navigation", { name: "Menu principal" })).queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
  });

  test("o submenu não lista mais Produtos nem Categorias e quartos (agora em Cadastros)", () => {
    renderizar(<Arvore />, { rota: "/configuracoes/usuarios", usuario: { permissoes: ["config.gerenciar", "cadastros.gerenciar"] } });
    const sub = screen.getByRole("navigation", { name: "Configurações" });
    expect(within(sub).getByRole("link", { name: "Usuários" })).toBeInTheDocument();
    expect(within(sub).getByRole("link", { name: "Pousada" })).toBeInTheDocument();
    expect(within(sub).queryByRole("link", { name: "Produtos" })).not.toBeInTheDocument();
    expect(within(sub).queryByRole("link", { name: /Categorias/ })).not.toBeInTheDocument();
    expect(screen.getByText("tela usuarios")).toBeInTheDocument();
  });

  test("/configuracoes leva à primeira tela permitida", async () => {
    instalarApiFalsa({ "GET /api/assistente": { pousada: true, quartos: true, equipe: true, categorias: [] } });
    renderizar(<Arvore />, { rota: "/configuracoes", usuario: { permissoes: ["config.gerenciar"] } });
    expect(await screen.findByText("tela pousada")).toBeInTheDocument();
  });

  test("só com cadastros.gerenciar a área não abre", () => {
    renderizar(<Arvore />, { rota: "/configuracoes/pousada", usuario: { permissoes: ["cadastros.gerenciar", "reservas.gerenciar"] } });
    expect(screen.getByText("inicio")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Configurações" })).not.toBeInTheDocument();
  });

  test("sem nenhuma das permissões a área não abre", () => {
    renderizar(<Arvore />, { rota: "/configuracoes/pousada", usuario: { permissoes: ["caixa.operar"] } });
    expect(screen.getByText("inicio")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Configurações" })).not.toBeInTheDocument();
  });
});

describe("acesso só a Cadastros", () => {
  test("perfil só com cadastros.gerenciar: Hoje redireciona para a tela de produtos e não há engrenagem", () => {
    const usuario = { permissoes: ["cadastros.gerenciar"] };
    renderizar(
      <>
        <MenuLateral atencao={0} />
        <Routes>
          <Route path="/" element={<ExigePermissao permissao="reservas.gerenciar"><p>hoje</p></ExigePermissao>} />
          <Route path="/cadastros/produtos" element={<ExigePermissao permissao="cadastros.gerenciar"><p>tela produtos</p></ExigePermissao>} />
        </Routes>
      </>,
      { rota: "/", usuario },
    );
    expect(screen.getByText("tela produtos")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
    expect(screen.queryByText("hoje")).not.toBeInTheDocument();
  });

  test("rotaInicial segue a ordem de precedência", () => {
    const u = (permissoes: string[]) => ({ ...usuarioPadrao, permissoes });
    expect(rotaInicial(u(["reservas.gerenciar", "config.gerenciar"]))).toBe("/");
    expect(rotaInicial(u(["quartos.situacao"]))).toBe("/governanca");
    expect(rotaInicial(u(["quartos.situacao", "config.gerenciar"]))).toBe("/configuracoes");
    expect(rotaInicial(u(["config.gerenciar"]))).toBe("/configuracoes");
    expect(rotaInicial(u(["cadastros.gerenciar"]))).toBe("/cadastros/produtos");
    expect(rotaInicial(u(["cadastros.gerenciar", "caixa.operar"]))).toBe("/cadastros/produtos");
    expect(rotaInicial(u(["cadastros.gerenciar", "config.gerenciar"]))).toBe("/configuracoes");
    expect(rotaInicial(u(["cadastros.gerenciar", "reservas.gerenciar"]))).toBe("/");
  });
});

describe("tela Pousada", () => {
  test("Pousada salva a seção Regras com o corpo esperado", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/config": CONFIG, "PUT /api/config": CONFIG });
    renderizar(<TelaPousada />);
    const regras = await screen.findByRole("region", { name: "Regras" });
    await u.clear(within(regras).getByLabelText("Prazo do sinal (horas)"));
    await u.type(within(regras).getByLabelText("Prazo do sinal (horas)"), "72");
    await u.click(within(regras).getByLabelText("Camareira lança frigobar"));
    await u.click(within(regras).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")).toBeDefined());
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({
      caminho: "/api/config",
      corpo: {
        arredondamento: "nenhum",
        sinal: { exigir: true, tipo: "percentual", percentual: 30, prazoHoras: 72, toleranciaHoras: 12 },
        earlyCheckin: { tipo: "fixo", valor: 5000 },
        lateCheckout: { tipo: "percentual_diaria", valor: 50 },
        idadeAdulto: 12,
        limiteCriancasGratis: 1,
        camareiraLancaFrigobar: true,
      },
    });
    // Salvar uma seção não envia campos de outras seções.
    const corpo = chamadas.find((c) => c.metodo === "PUT")!.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty("razaoSocial");
    expect(corpo).not.toHaveProperty("horaCheckin");
    expect(corpo).not.toHaveProperty("assistenteEquipePulado");
    expect(await within(regras).findByText("Salvo.")).toBeInTheDocument();
  });

  test("seção Horários salva só horários; seção Dados só dados", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/config": CONFIG, "PUT /api/config": CONFIG });
    renderizar(<TelaPousada />);
    const horarios = await screen.findByRole("region", { name: "Horários" });
    const entrada = within(horarios).getByLabelText("Check-in");
    expect(entrada).toHaveAttribute("type", "time");
    await u.clear(entrada);
    await u.type(entrada, "15:00");
    await u.click(within(horarios).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(1));
    expect(chamadas.find((c) => c.metodo === "PUT")!.corpo).toEqual({ horaCheckin: "15:00", horaCheckout: "12:00", viradaDia: "04:00" });
    await within(horarios).findByText("Salvo.");

    const dados = screen.getByRole("region", { name: "Dados" });
    // "Nome do estabelecimento" é o primeiro campo da seção Dados.
    const primeiro = within(dados).getAllByRole("textbox")[0]!;
    expect(primeiro).toBe(within(dados).getByLabelText("Nome do estabelecimento"));
    await u.clear(primeiro);
    await u.type(primeiro, "Vista Alegre");
    await u.clear(within(dados).getByLabelText("Razão social"));
    await u.type(within(dados).getByLabelText("Razão social"), "Nova Ltda");
    await u.click(within(dados).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(2));
    expect(chamadas.filter((c) => c.metodo === "PUT")[1]!.corpo).toEqual({
      nomeEstabelecimento: "Vista Alegre", razaoSocial: "Nova Ltda", cnpj: CONFIG.cnpj, endereco: CONFIG.endereco, fuso: "America/Sao_Paulo",
    });
    await within(dados).findByText("Salvo.");
  });

  test("salvar o nome do estabelecimento atualiza a marca do menu na hora", async () => {
    const u = userEvent.setup();
    let atual = CONFIG;
    instalarApiFalsa({
      "GET /api/config": () => atual,
      "PUT /api/config": (corpo: Partial<typeof CONFIG>) => {
        atual = { ...atual, ...corpo };
        return atual;
      },
    });
    renderizar(<><MenuLateral atencao={0} /><TelaPousada /></>, { usuario: { permissoes: ["config.gerenciar", "caixa.operar"] } });
    expect(await screen.findByText("Pousada Sol", { selector: ".menu__marca" })).toBeInTheDocument();
    const dados = await screen.findByRole("region", { name: "Dados" });
    await u.clear(within(dados).getByLabelText("Nome do estabelecimento"));
    await u.type(within(dados).getByLabelText("Nome do estabelecimento"), "Vista Alegre");
    await u.click(within(dados).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Vista Alegre", { selector: ".menu__marca" })).toBeInTheDocument();
  });

  test("percentual decimal da taxa mostra mensagem e bloqueia o Salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({ "GET /api/config": CONFIG, "PUT /api/config": CONFIG });
    renderizar(<TelaPousada />);
    const regras = await screen.findByRole("region", { name: "Regras" });
    const campo = within(regras).getByLabelText("Percentual (Late check-out)");
    await u.clear(campo);
    await u.type(campo, "12.5");
    expect(within(regras).getByRole("alert")).toHaveTextContent("Use um percentual inteiro");
    expect(within(regras).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  test("dados novos do servidor entram na seção sem edições e não sobrescrevem a seção editada", async () => {
    const u = userEvent.setup();
    let atual = CONFIG;
    instalarApiFalsa({ "GET /api/config": () => atual, "PUT /api/config": CONFIG });
    const { cliente } = renderizar(<TelaPousada />);
    const dados = await screen.findByRole("region", { name: "Dados" });
    const horarios = screen.getByRole("region", { name: "Horários" });
    await u.clear(within(dados).getByLabelText("Razão social"));
    await u.type(within(dados).getByLabelText("Razão social"), "Minha edição");

    atual = { ...CONFIG, razaoSocial: "Outro admin", horaCheckin: "16:00" };
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["config"] });
      // o React Query entrega o resultado em um timer: deixa a atualização acontecer dentro do act
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(within(horarios).getByLabelText("Check-in")).toHaveValue("16:00");
    expect(within(dados).getByLabelText("Razão social")).toHaveValue("Minha edição");
  });

  test("mostra a mensagem do servidor junto do Salvar", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/config": CONFIG,
      "PUT /api/config": { __status: 400, codigo: "VALIDACAO", mensagem: "Use o formato HH:MM" },
    });
    renderizar(<TelaPousada />);
    const horarios = await screen.findByRole("region", { name: "Horários" });
    await u.click(within(horarios).getByRole("button", { name: "Salvar" }));
    expect(await within(horarios).findByRole("alert")).toHaveTextContent("Use o formato HH:MM");
  });
});

describe("ListaCadastro", () => {
  type Item = { id: string; nome: string; ativo: boolean };
  const itens: Item[] = [
    { id: "1", nome: "Padrão", ativo: true },
    { id: "2", nome: "Suíte antiga", ativo: false },
  ];

  function Exemplo({ aoNovo, aoEditar, aoMostrar }: { aoNovo: () => void; aoEditar: (i: Item) => void; aoMostrar: (v: boolean) => void }) {
    return (
      <ListaCadastro<Item>
        titulo="Categorias"
        itens={itens}
        colunas={[{ titulo: "Nome", celula: (i) => i.nome }]}
        chave={(i) => i.id}
        inativo={(i) => !i.ativo}
        aoNovo={aoNovo}
        aoEditar={aoEditar}
        mostrarInativos={false}
        aoMostrarInativos={aoMostrar}
        renderPainel={({ item, fechar }) => (
          <div>
            <p>{item ? `editando ${item.nome}` : "criando"}</p>
            <button type="button" onClick={fechar}>Cancelar</button>
          </div>
        )}
      />
    );
  }

  test("Mostrar desativados e painel de edição", async () => {
    const u = userEvent.setup();
    const aoMostrar = vi.fn();
    const aoNovo = vi.fn();
    const aoEditar = vi.fn();
    renderizar(<Exemplo aoMostrar={aoMostrar} aoNovo={aoNovo} aoEditar={aoEditar} />);

    await u.click(screen.getByLabelText("Mostrar desativados"));
    expect(aoMostrar).toHaveBeenCalledWith(true);

    // linha inativa: esmaecida e com etiqueta
    const linhaInativa = screen.getByRole("row", { name: /Suíte antiga/ });
    expect(linhaInativa).toHaveClass("lista-cadastro__linha--inativa");
    expect(within(linhaInativa).getByText("desativado")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Padrão/ })).queryByText("desativado")).not.toBeInTheDocument();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "+ Novo" }));
    expect(aoNovo).toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText("criando")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await u.click(within(screen.getByRole("row", { name: /Padrão/ })).getByRole("button", { name: "Editar" }));
    expect(aoEditar).toHaveBeenCalledWith(itens[0]);
    expect(within(screen.getByRole("dialog")).getByText("editando Padrão")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
