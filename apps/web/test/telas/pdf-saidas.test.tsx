import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Relatorio } from "../../src/api/tipos";
import { TelaRelatorio } from "../../src/telas/relatorios/TelaRelatorio";
import { instalarApiFalsa } from "../api-falsa";
import { aguardarConsultas, renderizar } from "../ajuda";

const gerarPdfFalso = vi.hoisted(() => vi.fn());
vi.mock("../../src/telas/relatorios/gerarPdf", () => ({ gerarPdf: gerarPdfFalso }));

const relatorio: Relatorio = {
  id: "check-in",
  titulo: "Lista de check-in",
  subtitulo: "Chegadas em 20/11/2026",
  geradoEm: "2026-11-20T15:30:00.000Z",
  resumo: [],
  secoes: [{ colunas: [{ chave: "h", titulo: "Hóspede", tipo: "texto" }], linhas: [{ h: "Conceição" }] }],
};

const CONFIG = { nomeEstabelecimento: "Pousada Sol", razaoSocial: "Sol Ltda", cnpj: "1", endereco: "Rua A", horaCheckin: "14:00", horaCheckout: "12:00" };

function Tela() {
  return (
    <Routes>
      <Route path="/relatorios/:id" element={<TelaRelatorio />} />
    </Routes>
  );
}

function abrir() {
  instalarApiFalsa({ "GET /api/config": CONFIG, "GET /api/relatorios/check-in": relatorio });
  return renderizar(<Tela />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
}

let baixados: string[];

beforeEach(() => {
  gerarPdfFalso.mockReset().mockReturnValue(new Blob(["%PDF-falso"], { type: "application/pdf" }));
  baixados = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:falso", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    baixados.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).canShare;
  delete (navigator as unknown as Record<string, unknown>).share;
});

describe("Exportar PDF", () => {
  test("gera com o gerador (carregado sob demanda), cabeçalho da pousada, e baixa <id>-<data>.pdf", async () => {
    const r = abrir();
    expect(gerarPdfFalso).not.toHaveBeenCalled();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Exportar PDF" }));
    await waitFor(() => expect(baixados).toEqual(["check-in-2026-11-20.pdf"]));
    expect(gerarPdfFalso).toHaveBeenCalledWith(relatorio, { nome: "Pousada Sol", razaoSocial: "Sol Ltda", cnpj: "1", endereco: "Rua A", usuario: "Maria Recepção" });
    await aguardarConsultas(r.cliente);
  });

  test("o nome do arquivo usa a data do filtro, não a de hoje", async () => {
    instalarApiFalsa({ "GET /api/config": CONFIG, "GET /api/relatorios/check-in": relatorio });
    const r = renderizar(<Tela />, { rota: "/relatorios/check-in?data=2026-12-25", usuario: { permissoes: ["reservas.gerenciar"] } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Exportar PDF" }));
    await waitFor(() => expect(baixados).toEqual(["check-in-2026-12-25.pdf"]));
    await aguardarConsultas(r.cliente);
  });

  test("Imprimir e Exportar esperam a configuração da pousada (cabeçalho completo)", async () => {
    let liberar: (v: unknown) => void = () => {};
    instalarApiFalsa({ "GET /api/config": () => new Promise((ok) => (liberar = ok)), "GET /api/relatorios/check-in": relatorio });
    const r = renderizar(<Tela />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Exportar PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeDisabled();
    liberar(CONFIG);
    await waitFor(() => expect(screen.getByRole("button", { name: "Exportar PDF" })).toBeEnabled());
    await aguardarConsultas(r.cliente);
  });

  test("falha ao gerar mostra aviso e não baixa nada", async () => {
    gerarPdfFalso.mockImplementation(() => {
      throw new Error("quebrou");
    });
    const r = abrir();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Exportar PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível gerar o PDF");
    expect(baixados).toEqual([]);
    await aguardarConsultas(r.cliente);
  });

  test("desabilitado enquanto o relatório não chegou", async () => {
    instalarApiFalsa({ "GET /api/relatorios/check-in": () => new Promise(() => {}) });
    renderizar(<Tela />, { rota: "/relatorios/check-in", usuario: { permissoes: ["reservas.gerenciar"] } });
    expect(await screen.findByRole("button", { name: "Exportar PDF" })).toBeDisabled();
  });
});

describe("Compartilhar", () => {
  test("não aparece sem navigator.canShare (conexão sem HTTPS)", async () => {
    const r = abrir();
    await screen.findByRole("button", { name: "Exportar PDF" });
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    await aguardarConsultas(r.cliente);
  });

  test("não aparece quando canShare({ files }) é falso", async () => {
    Object.defineProperty(navigator, "canShare", { value: vi.fn(() => false), configurable: true });
    Object.defineProperty(navigator, "share", { value: vi.fn(), configurable: true });
    const r = abrir();
    await screen.findByRole("button", { name: "Exportar PDF" });
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    await aguardarConsultas(r.cliente);
  });

  test("com suporte, compartilha o PDF como arquivo", async () => {
    const canShare = vi.fn(() => true);
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const r = abrir();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = (share.mock.calls[0] as unknown as [{ files: File[]; title: string }])[0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]!.name).toBe("check-in-2026-11-20.pdf");
    expect(arg.files[0]!.type).toBe("application/pdf");
    expect(canShare).toHaveBeenCalledWith({ files: expect.any(Array) });
    await aguardarConsultas(r.cliente);
  });

  test("falha ao compartilhar não diz que o PDF não foi gerado", async () => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: vi.fn(async () => { throw new DOMException("sem gesto", "NotAllowedError"); }), configurable: true });
    const r = abrir();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Compartilhar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível compartilhar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("gerar o PDF");
    await aguardarConsultas(r.cliente);
  });

  test("cancelar a folha de compartilhamento não é erro", async () => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const share = vi.fn(async () => {
      throw new DOMException("cancelado", "AbortError");
    });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const r = abrir();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    await aguardarConsultas(r.cliente);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
