import { Route, Routes } from "react-router";
import { Login } from "./auth/Login";
import { ExigePermissao } from "./auth/ExigePermissao";
import { RotaProtegida } from "./auth/RotaProtegida";
import { TrocarSenha } from "./auth/TrocarSenha";
import { Shell } from "./layout/Shell";
import { TelaCaixa } from "./telas/caixa/TelaCaixa";
import { TelaGovernanca } from "./telas/governanca/TelaGovernanca";
import { TelaHoje } from "./telas/hoje/TelaHoje";
import { EmConstrucao } from "./telas/configuracoes/EmConstrucao";
import { LayoutConfiguracoes, PrimeiraConfiguracao } from "./telas/configuracoes/LayoutConfiguracoes";
import { TelaPousada } from "./telas/configuracoes/TelaPousada";
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
            {/* Marcadores: as tarefas 7 a 9 trocam cada um pela tela real. */}
            <Route path="categorias" element={<ExigePermissao permissao="cadastros.gerenciar"><EmConstrucao titulo="Categorias e quartos" /></ExigePermissao>} />
            <Route path="usuarios" element={<ExigePermissao permissao="config.gerenciar"><EmConstrucao titulo="Usuários" /></ExigePermissao>} />
            <Route path="perfis" element={<ExigePermissao permissao="config.gerenciar"><EmConstrucao titulo="Perfis" /></ExigePermissao>} />
            <Route path="produtos" element={<ExigePermissao permissao="cadastros.gerenciar"><EmConstrucao titulo="Produtos" /></ExigePermissao>} />
            <Route path="checklists" element={<ExigePermissao permissao="config.gerenciar"><EmConstrucao titulo="Checklists" /></ExigePermissao>} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
