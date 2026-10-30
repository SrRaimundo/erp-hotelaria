import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { instalarApiFalsa, verificarRotasNaoPrevistas } from "./api-falsa";

// Rede falsa por padrão (só a releitura da sessão é atendida), para a rede real nunca ser tocada nem alterar o estado de conexão.
beforeEach(() => instalarApiFalsa({}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  verificarRotasNaoPrevistas();
});

// jsdom não traz PointerEvent: sem isto, fireEvent.pointer* perde clientX/clientY/button/pointerId.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventFalso extends MouseEvent {
    pointerId: number;
    constructor(tipo: string, init: PointerEventInit = {}) {
      super(tipo, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: PointerEventFalso, configurable: true });
}
