import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { FinanceiroLayout, type AbaId } from "../../src/financeiro/FinanceiroLayout";
import { renderizar } from "../ajuda";

export const LOCAL = { id: "l1", nome: "Pousada Sol", ativo: true, hospedagem_padrao: true };
export const LOCAL_2 = { id: "l2", nome: "Sorveteria", ativo: true, hospedagem_padrao: false };
export const CAIXA = { id: "c1", local_id: "l1", nome: "Caixa", banco: "Sem banco", agencia: "0", numero: "0", tipo: "caixa", saldo_inicial: 0, saldo: 25000 };
export const BANCO = { id: "c2", local_id: "l1", nome: "Banco do Brasil", banco: "001", agencia: "1234", numero: "999-1", tipo: "corrente", saldo_inicial: 100000, saldo: 100000 };

/** Rotas que o layout sempre consulta (locais e contas do local). */
export const rotasBase = (locais = [LOCAL], contas = [CAIXA, BANCO]) => ({
  "GET /api/financeiro/locais": locais,
  "GET /api/financeiro/contas": contas,
});

/** Renderiza uma aba do Financeiro como o administrador e espera o layout carregar. */
export async function abrirAba(aba: AbaId) {
  const r = renderizar(<FinanceiroLayout aba={aba} />, { usuario: { permissoes: ["financeiro.gerenciar"], perfil: "admin" } });
  await waitFor(() => expect(r.cliente.isFetching()).toBe(0));
  return r;
}

/** Chamadas feitas a um caminho, na ordem. */
export const esperarChamada = async (lista: { metodo: string; caminho: string; corpo: unknown }[], metodo: string, inicio: string) => {
  await waitFor(() => expect(lista.find((c) => c.metodo === metodo && c.caminho.startsWith(inicio))).toBeDefined());
  return lista.find((c) => c.metodo === metodo && c.caminho.startsWith(inicio))!;
};

export const tela = screen;
