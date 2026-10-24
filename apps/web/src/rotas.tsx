import { Route, Routes } from "react-router";
import { Login } from "./auth/Login";
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
          <Route index element={<TelaHoje />} />
          <Route path="/mapa" element={<TelaMapa />} />
          <Route path="/reservas" element={<TelaReservas />} />
          <Route path="/reservas/nova" element={<TelaNovaReserva />} />
          <Route path="/caixa" element={<TelaCaixa />} />
          <Route path="/governanca" element={<TelaGovernanca />} />
        </Route>
      </Route>
    </Routes>
  );
}
