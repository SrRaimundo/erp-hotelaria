import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./estilo/tokens.css";
import "./estilo/base.css";
import "./componentes/componentes.css";
import "./layout/layout.css";

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
