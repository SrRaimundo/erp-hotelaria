import type { ReactElement } from "react";
import { Route, Routes } from "react-router";
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
import { TelaMapa } from "./telas/mapa/TelaMapa";
import { TelaNovaReserva } from "./telas/nova-reserva/TelaNovaReserva";
import { TelaReservas } from "./telas/reservas/TelaReservas";

/** Telas já construídas, por rota do menu. Itens do menu fora daqui viram "em breve": trocar é acrescentar uma linha. */
const TELAS_PRONTAS: Record<string, ReactElement> = {
  "/": <TelaHoje />,
  "/mapa": <TelaMapa />,
  "/reservas": <TelaReservas />,
  "/caixa": <TelaCaixa />,
  "/governanca": <TelaGovernanca />,
  "/cadastros/produtos": <TelaProdutos />,
};

const ITENS_MENU = GRUPOS_MENU.flatMap((g) => g.itens);
const guardada = (i: ItemMenu, tela: ReactElement) => (
  <ExigePermissao permissao={i.permissao} algumaDe={i.algumaDe}>{tela}</ExigePermissao>
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
          <Route path="/reservas/nova" element={<ExigePermissao permissao="reservas.gerenciar"><TelaNovaReserva /></ExigePermissao>} />
          <Route path="/configuracoes" element={<ExigePermissao algumaDe={["config.gerenciar", "cadastros.gerenciar"]}><LayoutConfiguracoes /></ExigePermissao>}>
            <Route index element={<PrimeiraConfiguracao />} />
            <Route path="pousada" element={<ExigePermissao permissao="config.gerenciar"><TelaPousada /></ExigePermissao>} />
            <Route path="categorias" element={<ExigePermissao permissao="cadastros.gerenciar"><TelaCategoriasQuartos /></ExigePermissao>} />
            <Route path="usuarios" element={<ExigePermissao permissao="config.gerenciar"><TelaUsuarios /></ExigePermissao>} />
            <Route path="perfis" element={<ExigePermissao permissao="config.gerenciar"><TelaPerfis /></ExigePermissao>} />
            <Route path="produtos" element={<ExigePermissao permissao="cadastros.gerenciar"><TelaProdutos /></ExigePermissao>} />
            <Route path="assistente" element={<ExigePermissao permissao="config.gerenciar"><Assistente /></ExigePermissao>} />
            <Route path="checklists" element={<ExigePermissao permissao="config.gerenciar"><TelaChecklists /></ExigePermissao>} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
