import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Dicas } from "../configuracoes/Dicas";
import { CampoPercentual } from "./CampoPercentual";
import { aposSalvarTarifa, useRegra, type DiaSemana } from "./consultas";

const DIAS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function TelaDiasSemana() {
  const cliente = useQueryClient();
  const q = useRegra<DiaSemana[]>("dias-semana", "/api/tarifas/dias-semana");
  const [valores, setValores] = useState<(number | null)[]>(() => DIAS.map(() => 0));
  const [salvo, setSalvo] = useState(false);
  useEffect(() => {
    if (q.data) setValores(DIAS.map((_, d) => q.data!.find((x) => x.dia === d)?.percentual ?? 0));
  }, [q.data]);

  const motivos = valores.some((v) => v === null)
    ? ["Informe um percentual válido para todos os dias (use 0 para nenhum ajuste)."]
    : valores.some((v) => v! <= -100) ? ["O percentual deve ser maior que -100."] : [];
  const salvar = useMutation<unknown, Error>({
    // A rota guarda um dia por vez: vão os sete, sempre, para a tela e o servidor ficarem iguais.
    mutationFn: async () => {
      for (let dia = 0; dia < DIAS.length; dia++) await chamarApi("PUT", "/api/tarifas/dias-semana", { dia, percentual: valores[dia]! });
    },
    onSuccess: async () => {
      setSalvo(true);
      await aposSalvarTarifa(cliente);
    },
  });

  return (
    <section className="tarifas__form" aria-label="Dias da semana">
      <h2>Dias da semana</h2>
      <p className="tarifas__aviso">Ajuste sobre a diária em cada dia da semana. Use valores negativos para desconto (ex.: -10).</p>
      <ErroAcao erro={q.error} />
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          setSalvo(false);
          if (motivos.length === 0) salvar.mutate();
        }}
      >
        {DIAS.map((nome, d) => (
          <CampoPercentual
            key={nome}
            rotulo={`${nome} (%)`}
            aceitaNegativo
            valor={valores[d]!}
            aoMudar={(v) => {
              setSalvo(false);
              setValores((a) => a.map((x, i) => (i === d ? v : x)));
            }}
          />
        ))}
        <Dicas motivos={motivos} />
        <ErroAcao erro={salvar.error} />
        {salvo && !salvar.error && <p className="tarifas__ok" role="status">Salvo.</p>}
        <div className="formulario__acoes">
          <Botao type="submit" disabled={motivos.length > 0 || salvar.isPending || q.isPending}>Salvar</Botao>
        </div>
      </form>
    </section>
  );
}
