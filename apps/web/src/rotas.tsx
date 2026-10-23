import { Outlet, Route, Routes } from "react-router";
import { Login } from "./auth/Login";
import { RotaProtegida } from "./auth/RotaProtegida";
import { TrocarSenha } from "./auth/TrocarSenha";

// Provisório até o Shell (Task 6); as telas seguintes trocam apenas os elementos desta tabela.
function Shell() {
  return (
    <main>
      <Outlet />
    </main>
  );
}
const Provisoria = ({ titulo }: { titulo: string }) => <h1>{titulo}</h1>;

export function AppRotas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route element={<RotaProtegida />}>
        <Route element={<Shell />}>
          <Route index element={<Provisoria titulo="Hoje" />} />
          <Route path="/mapa" element={<Provisoria titulo="Mapa" />} />
          <Route path="/reservas" element={<Provisoria titulo="Reservas" />} />
          <Route path="/reservas/nova" element={<Provisoria titulo="Nova reserva" />} />
          <Route path="/caixa" element={<Provisoria titulo="Caixa" />} />
          <Route path="/governanca" element={<Provisoria titulo="Governança" />} />
        </Route>
      </Route>
    </Routes>
  );
}
