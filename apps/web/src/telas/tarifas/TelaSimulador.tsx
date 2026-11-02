import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { chamarApi } from "../../api/cliente";
import type { Cotacao } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { formatarData, nomeDiaCurto } from "../../lib/datas";
import { formatarReais } from "../../lib/dinheiro";
import { Dicas } from "../configuracoes/Dicas";
import { adultosValidos, dataValida } from "../nova-reserva/CamposAcomodacao";
import { CANAL_REFERENCIA } from "./TelaCanais";
import { useCanais, useCategoriasTarifa } from "./consultas";

type Pedido = { categoriaId: string; chegada: string; saida: string; hospedes: { adultos: number; criancasNascimento: string[] }; canal: string };

/** Simula uma estadia e mostra o total e, noite a noite, o efeito de cada camada (base, temporada, dia, canal, ocupação...). Não grava nada. */
export function TelaSimulador() {
  const categoriasQ = useCategoriasTarifa();
  const canaisQ = useCanais();
  const categorias = (categoriasQ.data ?? []).filter((c) => c.ativo);
  const canais = canaisQ.data ?? [];

  const [categoriaEsc, setCategoriaEsc] = useState("");
  const [canalEsc, setCanalEsc] = useState("");
  const [chegada, setChegada] = useState("");
  const [saida, setSaida] = useState("");
  const [adultos, setAdultos] = useState("2");
  const [criancas, setCriancas] = useState<string[]>([]);

  const categoriaId = categoriaEsc || categorias[0]?.id || "";
  const canal = canalEsc || (canais.find((c) => c.nome === CANAL_REFERENCIA) ?? canais[0])?.nome || "";
  const nAdultos = adultosValidos(adultos);
  const motivos = [
    ...(categoriaId === "" ? ["Escolha a categoria."] : []),
    ...(canal === "" ? ["Escolha o canal."] : []),
    ...(!dataValida(chegada) || !dataValida(saida) ? ["Informe a chegada e a saída."] : saida <= chegada ? ["A saída deve ser depois da chegada."] : []),
    ...(nAdultos === null ? ["Informe ao menos 1 adulto."] : []),
    ...(criancas.some((c) => !dataValida(c)) ? ["Informe a data de nascimento de cada criança."] : []),
  ];

  const simular = useMutation<Cotacao, Error, Pedido>({ mutationFn: (p) => chamarApi<Cotacao>("POST", "/api/tarifas/simular", p) });
  const resultado = simular.data;

  return (
    <section className="tarifas__form" aria-label="Simulador">
      <h2>Simulador</h2>
      <p className="tarifas__aviso">Calcula o preço de uma estadia com as regras de hoje. Não cria reserva nem altera nada.</p>
      <ErroAcao erro={categoriasQ.error ?? canaisQ.error} />
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (motivos.length === 0) simular.mutate({ categoriaId, chegada, saida, hospedes: { adultos: nAdultos!, criancasNascimento: criancas }, canal });
        }}
      >
        <label className="campo">
          Categoria
          <select value={categoriaId} onChange={(e) => setCategoriaEsc(e.target.value)}>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <div className="tarifas__grade">
          <label className="campo">
            Chegada
            <input type="date" value={chegada} onChange={(e) => setChegada(e.target.value)} />
          </label>
          <label className="campo">
            Saída
            <input type="date" value={saida} onChange={(e) => setSaida(e.target.value)} />
          </label>
        </div>
        <label className="campo">
          Adultos
          <input type="number" min={1} value={adultos} onChange={(e) => setAdultos(e.target.value)} />
        </label>
        {criancas.map((nasc, i) => (
          <div className="campo" key={i}>
            <label htmlFor={`sim-crianca-${i}`}>{`Nascimento da criança ${i + 1}`}</label>
            <input id={`sim-crianca-${i}`} type="date" value={nasc} onChange={(e) => setCriancas((c) => c.map((x, j) => (j === i ? e.target.value : x)))} />
            <Botao variante="contorno" tamanho="pequeno" aria-label={`Remover criança ${i + 1}`} onClick={() => setCriancas((c) => c.filter((_, j) => j !== i))}>
              Remover
            </Botao>
          </div>
        ))}
        <div>
          <Botao variante="contorno" tamanho="pequeno" onClick={() => setCriancas((c) => [...c, ""])}>+ criança</Botao>
        </div>
        <label className="campo">
          Canal
          <select value={canal} onChange={(e) => setCanalEsc(e.target.value)}>
            {canais.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
          </select>
        </label>
        <Dicas motivos={motivos} />
        <ErroAcao erro={simular.error} />
        <div className="formulario__acoes">
          <Botao type="submit" disabled={motivos.length > 0 || simular.isPending}>Simular</Botao>
        </div>
      </form>

      {resultado && !simular.error && (
        <div aria-label="Resultado da simulação" role="region">
          <p className="tarifas__total">{`Total: ${formatarReais(resultado.total)}`}</p>
          {resultado.violacoes.map((v) => (
            <p key={`${v.codigo}-${v.data}`} role="alert" className="erro-acao">{v.mensagem}</p>
          ))}
          <ol className="tarifas__noites" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {resultado.noites.map((n) => (
              <li key={n.data} className="tarifas__noite">
                <div className="tarifas__noite-topo">
                  <span>{`${nomeDiaCurto(n.data)} ${formatarData(n.data, true)}`}</span>
                  <span>{formatarReais(n.valor)}</span>
                </div>
                <ul className="tarifas__passos">
                  {n.passos.map((p, i) => (
                    <li key={i}>
                      <span>{p.rotulo}</span>
                      <span>{formatarReais(p.valor)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
