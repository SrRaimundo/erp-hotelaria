import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { verificarRotasNaoPrevistas } from "./api-falsa";

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
