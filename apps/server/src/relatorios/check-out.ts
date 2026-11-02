import { listaDeMovimento } from "./check-in.js";
import { filtroData } from "./consulta.js";
import { definir } from "./modelo.js";

export const relatorioCheckOut = definir({
  id: "check-out",
  permissao: "reservas.gerenciar",
  filtros: filtroData,
  gerar: (ctx, f) => listaDeMovimento(ctx, { id: "check-out", titulo: "Lista de check-out", lado: "saida", rotuloTotal: "Saídas", data: f.data }),
});
