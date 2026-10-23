import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router";
import { criarQueryClient } from "./api/consultas";
import { SessaoProvider } from "./auth/SessaoProvider";
import { AppRotas } from "./rotas";

export function App() {
  const [cliente] = useState(criarQueryClient);
  return (
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <SessaoProvider>
          <AppRotas />
        </SessaoProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
