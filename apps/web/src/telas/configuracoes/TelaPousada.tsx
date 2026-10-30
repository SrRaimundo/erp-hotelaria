import { useId, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfig } from "../../api/consultas";
import { chamarApi } from "../../api/cliente";
import type { ConfigPousada } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { CampoDinheiro } from "../../componentes/CampoDinheiro";
import { ErroAcao } from "../../componentes/ErroAcao";
import "./configuracoes.css";

type RegraTaxa = ConfigPousada["earlyCheckin"];
/** Taxa em edição: valor vazio/inválido fica null e bloqueia o Salvar. */
type TaxaEdicao = { tipo: RegraTaxa["tipo"]; valor: number | null };

const FUSOS = [
  "America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia",
  "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha",
];

/** Texto de um campo numérico -> número, ou null se vazio/inválido. */
const lerNumero = (t: string): number | null => (t.trim() === "" || Number.isNaN(Number(t)) || Number(t) < 0 ? null : Number(t));

/** Cartão de uma seção: grava só os campos dela (o servidor mescla o restante). */
function Secao({ titulo, corpo, children }: { titulo: string; corpo: () => Partial<ConfigPousada> | null; children: ReactNode }) {
  const id = useId();
  const cliente = useQueryClient();
  const salvar = useMutation<unknown, Error, Partial<ConfigPousada>>({
    mutationFn: (c) => chamarApi("PUT", "/api/config", c),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["config"] }),
  });
  const pronto = corpo();
  return (
    <section className="pousada__secao" aria-labelledby={id}>
      <h2 id={id}>{titulo}</h2>
      <form
        className="formulario"
        onChange={() => salvar.isSuccess && salvar.reset()}
        onSubmit={(e) => {
          e.preventDefault();
          if (pronto) salvar.mutate(pronto);
        }}
      >
        {children}
        <ErroAcao erro={salvar.error} />
        <div className="pousada__rodape">
          {salvar.isSuccess && <span className="pousada__ok" role="status">Salvo.</span>}
          <Botao type="submit" disabled={!pronto || salvar.isPending}>Salvar</Botao>
        </div>
      </form>
    </section>
  );
}

function Texto({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="campo">
      {rotulo}
      <input value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

function Hora({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="campo">
      {rotulo}
      <input type="time" value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

function Numero({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="campo">
      {rotulo}
      <input type="number" min={0} step="any" inputMode="decimal" value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

function SecaoDados({ config }: { config: ConfigPousada }) {
  const [razaoSocial, setRazao] = useState(config.razaoSocial);
  const [cnpj, setCnpj] = useState(config.cnpj);
  const [endereco, setEndereco] = useState(config.endereco);
  const [fuso, setFuso] = useState(config.fuso);
  const fusos = FUSOS.includes(fuso) ? FUSOS : [fuso, ...FUSOS];
  return (
    <Secao titulo="Dados" corpo={() => ({ razaoSocial, cnpj, endereco, fuso })}>
      <Texto rotulo="Razão social" valor={razaoSocial} aoMudar={setRazao} />
      <Texto rotulo="CNPJ" valor={cnpj} aoMudar={setCnpj} />
      <Texto rotulo="Endereço" valor={endereco} aoMudar={setEndereco} />
      <label className="campo">
        Fuso horário
        <select value={fuso} onChange={(e) => setFuso(e.target.value)}>
          {fusos.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </label>
    </Secao>
  );
}

function SecaoHorarios({ config }: { config: ConfigPousada }) {
  const [horaCheckin, setIn] = useState(config.horaCheckin);
  const [horaCheckout, setOut] = useState(config.horaCheckout);
  const [viradaDia, setVirada] = useState(config.viradaDia);
  const completo = horaCheckin !== "" && horaCheckout !== "" && viradaDia !== "";
  return (
    <Secao titulo="Horários" corpo={() => (completo ? { horaCheckin, horaCheckout, viradaDia } : null)}>
      <div className="pousada__grade">
        <Hora rotulo="Check-in" valor={horaCheckin} aoMudar={setIn} />
        <Hora rotulo="Check-out" valor={horaCheckout} aoMudar={setOut} />
        <Hora rotulo="Virada do dia hoteleiro" valor={viradaDia} aoMudar={setVirada} />
      </div>
    </Secao>
  );
}

/** Taxa de early check-in / late check-out: valor fixo em reais ou percentual da diária. */
function CampoTaxa({ rotulo, regra, aoMudar }: { rotulo: string; regra: TaxaEdicao; aoMudar: (r: TaxaEdicao) => void }) {
  return (
    <fieldset className="pousada__grupo">
      <legend>{rotulo}</legend>
      <label className="campo">
        Tipo ({rotulo})
        <select value={regra.tipo} onChange={(e) => aoMudar({ tipo: e.target.value as RegraTaxa["tipo"], valor: 0 })}>
          <option value="fixo">Valor fixo (R$)</option>
          <option value="percentual_diaria">Percentual da diária (%)</option>
        </select>
      </label>
      {regra.tipo === "fixo" ? (
        <CampoDinheiro rotulo={`Valor (${rotulo})`} valor={regra.valor} aoMudar={(c) => aoMudar({ ...regra, valor: c })} />
      ) : (
        <Numero rotulo={`Percentual (${rotulo})`} valor={regra.valor === null ? "" : String(regra.valor)} aoMudar={(t) => aoMudar({ ...regra, valor: lerNumero(t) })} />
      )}
    </fieldset>
  );
}

function SecaoRegras({ config }: { config: ConfigPousada }) {
  const [exigir, setExigir] = useState(config.sinal.exigir);
  const [tipoSinal, setTipoSinal] = useState(config.sinal.tipo);
  const [percentual, setPercentual] = useState(String(config.sinal.percentual));
  const [prazo, setPrazo] = useState(String(config.sinal.prazoHoras));
  const [tolerancia, setTolerancia] = useState(String(config.sinal.toleranciaHoras));
  const [early, setEarly] = useState<TaxaEdicao>(config.earlyCheckin);
  const [late, setLate] = useState<TaxaEdicao>(config.lateCheckout);
  const [idade, setIdade] = useState(String(config.idadeAdulto));
  const [criancas, setCriancas] = useState(String(config.limiteCriancasGratis));
  const [arredondamento, setArredondamento] = useState(config.arredondamento);
  const [frigobar, setFrigobar] = useState(config.camareiraLancaFrigobar);

  const n = { percentual: lerNumero(percentual), prazo: lerNumero(prazo), tolerancia: lerNumero(tolerancia), idade: lerNumero(idade), criancas: lerNumero(criancas) };
  const taxaOk = (r: TaxaEdicao): r is RegraTaxa => r.valor !== null && Number.isInteger(r.valor);
  const completo =
    n.percentual !== null && n.prazo !== null && n.tolerancia !== null && n.idade !== null && n.criancas !== null && taxaOk(early) && taxaOk(late);

  return (
    <Secao
      titulo="Regras"
      corpo={() =>
        completo
          ? {
              sinal: { exigir, tipo: tipoSinal, percentual: n.percentual!, prazoHoras: n.prazo!, toleranciaHoras: n.tolerancia! },
              earlyCheckin: early as RegraTaxa,
              lateCheckout: late as RegraTaxa,
              idadeAdulto: n.idade!,
              limiteCriancasGratis: n.criancas!,
              arredondamento,
              camareiraLancaFrigobar: frigobar,
            }
          : null
      }
    >
      <fieldset className="pousada__grupo">
        <legend>Sinal</legend>
        <label className="pousada__marcar">
          <input type="checkbox" checked={exigir} onChange={(e) => setExigir(e.target.checked)} />
          Exigir sinal
        </label>
        <div className="pousada__grade">
          <label className="campo">
            Cálculo do sinal
            <select value={tipoSinal} onChange={(e) => setTipoSinal(e.target.value as typeof tipoSinal)}>
              <option value="percentual">Percentual do total</option>
              <option value="primeira_diaria">Primeira diária</option>
            </select>
          </label>
          <Numero rotulo="Percentual do sinal (%)" valor={percentual} aoMudar={setPercentual} />
          <Numero rotulo="Prazo do sinal (horas)" valor={prazo} aoMudar={setPrazo} />
          <Numero rotulo="Tolerância do sinal (horas)" valor={tolerancia} aoMudar={setTolerancia} />
        </div>
      </fieldset>
      <div className="pousada__grade">
        <CampoTaxa rotulo="Early check-in" regra={early} aoMudar={setEarly} />
        <CampoTaxa rotulo="Late check-out" regra={late} aoMudar={setLate} />
      </div>
      <div className="pousada__grade">
        <Numero rotulo="Idade a partir da qual conta como adulto" valor={idade} aoMudar={setIdade} />
        <Numero rotulo="Crianças grátis por quarto" valor={criancas} aoMudar={setCriancas} />
        <label className="campo">
          Arredondamento
          <select value={arredondamento} onChange={(e) => setArredondamento(e.target.value as typeof arredondamento)}>
            <option value="nenhum">Nenhum</option>
            <option value="real">Real inteiro</option>
          </select>
        </label>
      </div>
      <label className="pousada__marcar">
        <input type="checkbox" checked={frigobar} onChange={(e) => setFrigobar(e.target.checked)} />
        Camareira lança frigobar
      </label>
    </Secao>
  );
}

export function TelaPousada() {
  const config = useConfig();
  return (
    <div className="pousada">
      <h1>Pousada</h1>
      {config.isError && <ErroAcao erro={config.error} />}
      {config.data ? (
        <>
          <SecaoDados config={config.data} />
          <SecaoHorarios config={config.data} />
          <SecaoRegras config={config.data} />
        </>
      ) : (
        !config.isError && <p>Carregando…</p>
      )}
    </div>
  );
}
