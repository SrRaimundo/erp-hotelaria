import { Route, Routes } from "react-router";
import { Login } from "./auth/Login";
import { ExigePermissao } from "./auth/ExigePermissao";
import { RotaProtegida } from "./auth/RotaProtegida";
import { TrocarSenha } from "./auth/TrocarSenha";
import { Shell } from "./layout/Shell";
import { TelaCaixa } from "./telas/caixa/TelaCaixa";
import { TelaGovernanca } from "./telas/governanca/TelaGovernanca";
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

export function AppRotas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route element={<RotaProtegida />}>
        <Route element={<Shell />}>
          <Route index element={<ExigePermissao permissao="reservas.gerenciar"><TelaHoje /></ExigePermissao>} />
          <Route path="/mapa" element={<ExigePermissao permissao="reservas.gerenciar"><TelaMapa /></ExigePermissao>} />
          <Route path="/reservas" element={<ExigePermissao permissao="reservas.gerenciar"><TelaReservas /></ExigePermissao>} />
          <Route path="/reservas/nova" element={<ExigePermissao permissao="reservas.gerenciar"><TelaNovaReserva /></ExigePermissao>} />
          <Route path="/caixa" element={<ExigePermissao permissao="caixa.operar"><TelaCaixa /></ExigePermissao>} />
          <Route path="/governanca" element={<ExigePermissao permissao="quartos.situacao"><TelaGovernanca /></ExigePermissao>} />
          <Route path="/configuracoes" element={<ExigePermissao algumaDe={["config.gerenciar", "cadastros.gerenciar"]}><LayoutConfiguracoes /></ExigePermissao>}>
            <Route index element={<PrimeiraConfiguracao />} />
            <Route path="pousada" element={<ExigePermissao permissao="config.gerenciar"><TelaPousada /></ExigePermissao>} />
            <Route path="categorias" element={<ExigePermissao permissao="cadastros.gerenciar"><TelaCategoriasQuartos /></ExigePermissao>} />
            <Route path="usuarios" element={<ExigePermissao permissao="config.gerenciar"><TelaUsuarios /></ExigePermissao>} />
            <Route path="perfis" element={<ExigePermissao permissao="config.gerenciar"><TelaPerfis /></ExigePermissao>} />
            <Route path="produtos" element={<ExigePermissao permissao="cadastros.gerenciar"><TelaProdutos /></ExigePermissao>} />
            <Route path="checklists" element={<ExigePermissao permissao="config.gerenciar"><TelaChecklists /></ExigePermissao>} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
