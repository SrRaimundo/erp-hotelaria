import { Route, Routes } from "react-router";
import { Login } from "./auth/Login";
import { ExigePermissao } from "./auth/ExigePermissao";
import { RotaProtegida } from "./auth/RotaProtegida";
import { TrocarSenha } from "./auth/TrocarSenha";
import { Shell } from "./layout/Shell";
import { TelaCaixa } from "./telas/caixa/TelaCaixa";
import { TelaGovernanca } from "./telas/governanca/TelaGovernanca";
import { TelaHoje } from "./telas/hoje/TelaHoje";
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
        </Route>
      </Route>
    </Routes>
  );
}
