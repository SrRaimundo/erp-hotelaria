import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ExigePermissao } from "../../src/auth/ExigePermissao";
import { MenuLateral } from "../../src/layout/MenuLateral";
import { ListaCadastro } from "../../src/telas/configuracoes/ListaCadastro";
import { LayoutConfiguracoes, PrimeiraConfiguracao } from "../../src/telas/configuracoes/LayoutConfiguracoes";
import { TelaPousada } from "../../src/telas/configuracoes/TelaPousada";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";

afterEach(() => vi.unstubAllGlobals());

const CONFIG = {
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
      <Route path="/configuracoes" element={<ExigePermissao algumaDe={["config.gerenciar", "cadastros.gerenciar"]}><LayoutConfiguracoes /></ExigePermissao>}>
        <Route index element={<PrimeiraConfiguracao />} />
        <Route path="pousada" element={<p>tela pousada</p>} />
        <Route path="categorias" element={<p>tela categorias</p>} />
      </Route>
    </Routes>
  );
}

describe("área Configurações", () => {
  test("menu Configurações só com permissão; submenu mostra só as telas permitidas", () => {
    const { unmount } = renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["caixa.operar", "quartos.situacao"] } });
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
    unmount();
    renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["caixa.operar", "cadastros.gerenciar"] } });
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/configuracoes");
  });

  test("menu aparece também só com config.gerenciar", () => {
    renderizar(<MenuLateral atencao={0} />, { usuario: { permissoes: ["caixa.operar", "config.gerenciar"] } });
    expect(screen.getByRole("link", { name: "Configurações" })).toBeInTheDocument();
  });

  test("submenu só lista as telas da permissão do usuário", () => {
    renderizar(<Arvore />, { rota: "/configuracoes/categorias", usuario: { permissoes: ["cadastros.gerenciar"] } });
    const sub = screen.getByRole("navigation", { name: "Configurações" });
    expect(within(sub).getByRole("link", { name: "Categorias e quartos" })).toBeInTheDocument();
    expect(within(sub).getByRole("link", { name: "Produtos" })).toBeInTheDocument();
    expect(within(sub).queryByRole("link", { name: "Pousada" })).not.toBeInTheDocument();
    expect(within(sub).queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
    expect(screen.getByText("tela categorias")).toBeInTheDocument();
  });

  test("/configuracoes leva à primeira tela permitida", () => {
    renderizar(<Arvore />, { rota: "/configuracoes", usuario: { permissoes: ["cadastros.gerenciar"] } });
    expect(screen.getByText("tela categorias")).toBeInTheDocument();
  });

  test("sem nenhuma das permissões a área não abre", () => {
    renderizar(<Arvore />, { rota: "/configuracoes/pousada", usuario: { permissoes: ["caixa.operar"] } });
    expect(screen.getByText("inicio")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Configurações" })).not.toBeInTheDocument();
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
    await u.clear(within(dados).getByLabelText("Razão social"));
    await u.type(within(dados).getByLabelText("Razão social"), "Nova Ltda");
    await u.click(within(dados).getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(2));
    expect(chamadas.filter((c) => c.metodo === "PUT")[1]!.corpo).toEqual({
      razaoSocial: "Nova Ltda", cnpj: CONFIG.cnpj, endereco: CONFIG.endereco, fuso: "America/Sao_Paulo",
    });
    await within(dados).findByText("Salvo.");
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
