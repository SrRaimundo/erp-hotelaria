import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FinanceiroLayout } from "../../src/financeiro/FinanceiroLayout";
import { chamadas, instalarApiFalsa } from "../api-falsa";
import { renderizar } from "../ajuda";
import { esperarChamada } from "./base";

afterEach(() => vi.unstubAllGlobals());

const IGN = (extra = {}) => ({
  seq: 11, tipo: "hospedagem.PagamentoEstornado", valor: 5000, motivo: "Dado inválido", ator: "usuario-admin", criado_em: "2026-11-10T15:00:00.000Z",
  corrigido: false, correcao_em: null, correcao_por: null, correcao_motivo: null, ...extra,
});
const fila = (ignorados: unknown[]) => ({ cursor: 12, pendentes: 0, bloqueado: null, ignorados });
const abrir = () => renderizar(<FinanceiroLayout aba="fila" />, { usuario: { permissoes: ["config.gerenciar"], perfil: "admin" } });

describe("Fila: Aplicar correção", () => {
  test("o aviso do Ignorar não manda lançar à mão e aponta a correção", async () => {
    instalarApiFalsa({
      "GET /api/financeiro/locais": [],
      "GET /api/financeiro/fila": { cursor: 10, pendentes: 1, bloqueado: { seq: 11, tipo: "hospedagem.PagamentoEstornado", valor: 5000, erro: "x", falhas: 3, criado_em: "2026-11-10T15:00:00.000Z" }, ignorados: [] },
    });
    abrir();
    expect(await screen.findByText(/Aplicar correção/)).toBeInTheDocument();
    expect(screen.queryByText(/à mão/)).not.toBeInTheDocument();
  });

  test("evento ignorado oferece Aplicar correção, que pede motivo e supervisor e envia o número do evento", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [], "GET /api/financeiro/fila": fila([IGN()]),
      "POST /api/financeiro/fila/ignorados/11/aplicar-correcao": fila([IGN({ corrigido: true })]),
    });
    abrir();
    const linha = (await screen.findByText("Dado inválido")).closest("tr")!;
    await u.click(within(linha).getByRole("button", { name: "Aplicar correção" }));
    const janela = await screen.findByRole("dialog", { name: "Aplicar correção" });
    expect(janela).toHaveTextContent("desfaz o recebimento");
    await u.type(within(janela).getByLabelText("Motivo"), "Conferido");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    const post = await esperarChamada(chamadas, "POST", "/api/financeiro/fila/ignorados/11/aplicar-correcao");
    expect(post.corpo).toEqual({ motivo: "Conferido", supervisor: { login: "admin", senha: "admin" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Aplicar correção" })).not.toBeInTheDocument());
  });

  test("evento já corrigido mostra quem e quando, sem o botão", async () => {
    instalarApiFalsa({ "GET /api/financeiro/locais": [], "GET /api/financeiro/fila": fila([IGN({ corrigido: true, correcao_em: "2026-11-11T10:00:00.000Z", correcao_por: "usuario-admin", correcao_motivo: "Conferido" })]) });
    abrir();
    const linha = (await screen.findByText("Dado inválido")).closest("tr")!;
    expect(within(linha).queryByRole("button", { name: "Aplicar correção" })).not.toBeInTheDocument();
    expect(within(linha).getByText(/Correção aplicada/)).toBeInTheDocument();
  });

  test("o erro do servidor (nada a desfazer) aparece na janela", async () => {
    const u = userEvent.setup();
    instalarApiFalsa({
      "GET /api/financeiro/locais": [], "GET /api/financeiro/fila": fila([IGN()]),
      "POST /api/financeiro/fila/ignorados/11/aplicar-correcao": { __status: 422, codigo: "ESTADO_INVALIDO", mensagem: "Não há nada a desfazer: o lançamento já estava desfeito." },
    });
    abrir();
    await u.click(within((await screen.findByText("Dado inválido")).closest("tr")!).getByRole("button", { name: "Aplicar correção" }));
    const janela = await screen.findByRole("dialog", { name: "Aplicar correção" });
    await u.type(within(janela).getByLabelText("Motivo"), "x");
    await u.type(within(janela).getByLabelText("Login do supervisor"), "admin");
    await u.type(within(janela).getByLabelText("Senha do supervisor"), "admin");
    await u.click(within(janela).getByRole("button", { name: "Autorizar" }));
    expect(await within(janela).findByRole("alert")).toHaveTextContent("Não há nada a desfazer");
  });
});
