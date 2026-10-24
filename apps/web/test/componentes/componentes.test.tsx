import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { CampoDinheiro } from "../../src/componentes/CampoDinheiro";
import { ErroAcao } from "../../src/componentes/ErroAcao";
import { Gaveta } from "../../src/componentes/Gaveta";
import { Janela } from "../../src/componentes/Janela";
import { JanelaSupervisor } from "../../src/componentes/JanelaSupervisor";

describe("componentes base", () => {
  test("ErroAcao mostra a mensagem com role alert", () => {
    render(<ErroAcao erro={new Error("Quarto ocupado.")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Quarto ocupado.");
  });

  test("JanelaSupervisor exige motivo e mostra erro do servidor", async () => {
    const u = userEvent.setup();
    const confirmar = vi.fn().mockRejectedValueOnce(new Error("Supervisor sem permissão.")).mockResolvedValue(undefined);
    render(<JanelaSupervisor aberta titulo="Autorizar desconto" aoCancelar={() => {}} aoConfirmar={confirmar} />);
    expect(screen.getByRole("dialog", { name: "Autorizar desconto" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Autorizar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o motivo.");
    expect(confirmar).not.toHaveBeenCalled();

    await u.type(screen.getByLabelText("Motivo"), "Cortesia");
    await u.type(screen.getByLabelText("Login do supervisor"), "sup");
    await u.type(screen.getByLabelText("Senha do supervisor"), "segredo");
    await u.click(screen.getByRole("button", { name: "Autorizar" }));
    expect(confirmar).toHaveBeenCalledWith({ motivo: "Cortesia", supervisor: { login: "sup", senha: "segredo" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Supervisor sem permissão.");
  });

  test("JanelaSupervisor cancela", async () => {
    const u = userEvent.setup();
    const cancelar = vi.fn();
    render(<JanelaSupervisor aberta titulo="Autorizar" aoCancelar={cancelar} aoConfirmar={async () => {}} />);
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  test("CampoDinheiro converte e sinaliza inválido", async () => {
    const u = userEvent.setup();
    const mudou = vi.fn();
    function Caso() {
      const [v, setV] = useState<number | null>(null);
      return (
        <CampoDinheiro
          rotulo="Valor"
          valor={v}
          aoMudar={(c) => {
            mudou(c);
            setV(c);
          }}
        />
      );
    }
    render(<Caso />);
    const campo = screen.getByLabelText("Valor");
    expect(campo).toHaveAttribute("placeholder", "0,00");
    await u.type(campo, "12,5");
    expect(mudou).toHaveBeenLastCalledWith(1250);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await u.clear(campo);
    await u.type(campo, "abc");
    expect(mudou).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent("Valor inválido");
    await u.clear(campo);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("Gaveta fecha com Esc, não bloqueia a página e some quando fechada", async () => {
    const u = userEvent.setup();
    const fechar = vi.fn();
    const atras = vi.fn();
    const { rerender } = render(
      <>
        <button onClick={atras}>Atrás</button>
        <Gaveta aberta aoFechar={fechar} titulo="Reserva">
          conteúdo
        </Gaveta>
      </>,
    );
    const gaveta = screen.getByRole("dialog", { name: "Reserva" });
    expect(gaveta).not.toHaveAttribute("aria-modal", "true");
    await u.click(screen.getByRole("button", { name: "Atrás" }));
    expect(atras).toHaveBeenCalled();
    await u.keyboard("{Escape}");
    expect(fechar).toHaveBeenCalledTimes(1);
    rerender(
      <Gaveta aberta={false} aoFechar={fechar} titulo="Reserva">
        conteúdo
      </Gaveta>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Janela é modal, foca o primeiro campo e só a de cima fecha com Esc", async () => {
    const u = userEvent.setup();
    const fecharGaveta = vi.fn();
    const fecharJanela = vi.fn();
    const tela = (janelaAberta: boolean) => (
      <Gaveta aberta aoFechar={fecharGaveta} titulo="Reserva">
        <Janela aberta={janelaAberta} aoFechar={fecharJanela} titulo="Confirmar">
          <input aria-label="Primeiro" />
        </Janela>
      </Gaveta>
    );
    const { rerender } = render(tela(false));
    rerender(tela(true));
    expect(screen.getByRole("dialog", { name: "Confirmar" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Primeiro")).toHaveFocus();
    await u.keyboard("{Escape}");
    expect(fecharJanela).toHaveBeenCalledTimes(1);
    expect(fecharGaveta).not.toHaveBeenCalled();
  });
});
