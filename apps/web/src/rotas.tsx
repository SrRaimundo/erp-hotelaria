import { Route, Routes } from "react-router";
import { Login } from "./auth/Login";
import { RotaProtegida } from "./auth/RotaProtegida";
import { TrocarSenha } from "./auth/TrocarSenha";
import { Shell } from "./layout/Shell";
import { TelaHoje } from "./telas/hoje/TelaHoje";
import { TelaMapa } from "./telas/mapa/TelaMapa";
import { TelaNovaReserva } from "./telas/nova-reserva/TelaNovaReserva";

const Provisoria = ({ titulo }: { titulo: string }) => <h1>{titulo}</h1>;

export function AppRotas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route element={<RotaProtegida />}>
        <Route element={<Shell />}>
          <Route index element={<TelaHoje />} />
          <Route path="/mapa" element={<TelaMapa />} />
          <Route path="/reservas" element={<Provisoria titulo="Reservas" />} />
          <Route path="/reservas/nova" element={<TelaNovaReserva />} />
          <Route path="/caixa" element={<Provisoria titulo="Caixa" />} />
          <Route path="/governanca" element={<Provisoria titulo="Governança" />} />
        </Route>
      </Route>
    </Routes>
  );
}
