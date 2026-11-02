import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Login } from "./auth/Login";
import { ExigePermissao } from "./auth/ExigePermissao";
import { RotaProtegida } from "./auth/RotaProtegida";
import { TrocarSenha } from "./auth/TrocarSenha";
import { GRUPOS_MENU, type ItemMenu } from "./layout/menu";
import { Shell } from "./layout/Shell";
import { Assistente } from "./telas/assistente/Assistente";
import { TelaCaixa } from "./telas/caixa/TelaCaixa";
import { TelaGovernanca } from "./telas/governanca/TelaGovernanca";
import { TelaEmBreve } from "./telas/em-breve/TelaEmBreve";
import { TelaHoje } from "./telas/hoje/TelaHoje";
import { TelaChecklists } from "./telas/configuracoes/TelaChecklists";
import { TelaCategoriasQuartos } from "./telas/configuracoes/TelaCategoriasQuartos";
import { LayoutConfiguracoes, PrimeiraConfiguracao } from "./telas/configuracoes/LayoutConfiguracoes";
import { TelaProdutos } from "./telas/configuracoes/TelaProdutos";
import { TelaPerfis } from "./telas/configuracoes/TelaPerfis";
import { TelaPousada } from "./telas/configuracoes/TelaPousada";
import { TelaUsuarios } from "./telas/configuracoes/TelaUsuarios";
import { LayoutTarifas, PrimeiraAbaTarifas } from "./telas/tarifas/LayoutTarifas";
import { TelaMapa } from "./telas/mapa/TelaMapa";
import { TelaNovaReserva } from "./telas/nova-reserva/TelaNovaReserva";
import { TelaReservas } from "./telas/reservas/TelaReservas";
import { TelaRelatorio } from "./telas/relatorios/TelaRelatorio";
import { TelaRelatorios } from "./telas/relatorios/TelaRelatorios";

/** Telas já construídas, por rota do menu. Itens do menu fora daqui viram "em breve": trocar é acrescentar uma linha. */
const TELAS_PRONTAS: Record<string, ReactElement> = {
  "/": <TelaHoje />,
  "/mapa": <TelaMapa />,
  "/reservas": <TelaReservas />,
  "/caixa": <TelaCaixa />,
  "/governanca": <TelaGovernanca />,
  "/relatorios": <TelaRelatorios />,
  "/cadastros/produtos": <TelaProdutos />,
  "/cadastros/categorias-e-quartos": <TelaCategoriasQuartos />,
};

/** Tarifas tem rotas aninhadas próprias (abas), declaradas à parte. */
const ITENS_MENU = GRUPOS_MENU.flatMap((g) => g.itens).filter((i) => i.para !== "/reservas/tarifas");
const guardada = (i: ItemMenu, tela: ReactElement) => (
  <ExigePermissao permissao={i.permissao}>{tela}</ExigePermissao>
);

export function AppRotas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route element={<RotaProtegida />}>
        <Route element={<Shell />}>
          {ITENS_MENU.map((i) => {
            const tela = guardada(i, TELAS_PRONTAS[i.para] ?? <TelaEmBreve titulo={i.rotulo} />);
            return i.para === "/" ? <Route key={i.para} index element={tela} /> : <Route key={i.para} path={i.para} element={tela} />;
          })}
          {/* Sem a guarda no layout: cada aba pede a sua permissão (o Simulador só pede reservas.gerenciar). */}
          <Route path="/reservas/tarifas" element={<LayoutTarifas />}>
            <Route index element={<PrimeiraAbaTarifas />} />
          </Route>
          <Route path="/reservas/nova" element={<ExigePermissao permissao="reservas.gerenciar"><TelaNovaReserva /></ExigePermissao>} />
          <Route path="/relatorios/:id" element={<TelaRelatorio />} />
          {/* Endereços antigos: Produtos e Categorias e quartos agora vivem em Cadastros (fora da guarda de Configurações). */}
          <Route path="/configuracoes/produtos" element={<Navigate to="/cadastros/produtos" replace />} />
          <Route path="/configuracoes/categorias" element={<Navigate to="/cadastros/categorias-e-quartos" replace />} />
          <Route path="/configuracoes" element={<ExigePermissao permissao="config.gerenciar"><LayoutConfiguracoes /></ExigePermissao>}>
            <Route index element={<PrimeiraConfiguracao />} />
            <Route path="pousada" element={<ExigePermissao permissao="config.gerenciar"><TelaPousada /></ExigePermissao>} />
            <Route path="usuarios" element={<ExigePermissao permissao="config.gerenciar"><TelaUsuarios /></ExigePermissao>} />
            <Route path="perfis" element={<ExigePermissao permissao="config.gerenciar"><TelaPerfis /></ExigePermissao>} />
            <Route path="assistente" element={<ExigePermissao permissao="config.gerenciar"><Assistente /></ExigePermissao>} />
            <Route path="checklists" element={<ExigePermissao permissao="config.gerenciar"><TelaChecklists /></ExigePermissao>} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
