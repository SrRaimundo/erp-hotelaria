import { useEffect, useId, useState, type ReactNode } from "react";
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

/**
 * Estado de uma seção. Enquanto não houver edição do usuário, acompanha os dados novos do servidor;
 * depois de editar (sujo), preserva o que foi digitado até salvar.
 */
function useEditavel<T extends object>(inicial: T, aoMudarSujo?: (sujo: boolean) => void) {
  const [v, setV] = useState(inicial);
  const [sujo, setSujo] = useState(false);
  const assinatura = JSON.stringify(inicial);
  useEffect(() => aoMudarSujo?.(sujo), [sujo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sujo) setV(inicial);
  }, [assinatura]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    v,
    mudar: (p: Partial<T>) => {
      setSujo(true);
      setV((x) => ({ ...x, ...p }));
    },
    salvo: () => setSujo(false),
  };
}

/** Cartão de uma seção: grava só os campos dela (o servidor mescla o restante). */
function Secao({ titulo, corpo, aoSalvo, children }: { titulo: string; corpo: Partial<ConfigPousada> | null; aoSalvo: () => void; children: ReactNode }) {
  const id = useId();
  const cliente = useQueryClient();
  const salvar = useMutation<unknown, Error, Partial<ConfigPousada>>({
    mutationFn: (c) => chamarApi("PUT", "/api/config", c),
    onSuccess: async () => {
      aoSalvo();
      await cliente.invalidateQueries({ queryKey: ["config"] });
    },
  });
  return (
    <section className="pousada__secao" aria-labelledby={id}>
      <h2 id={id}>{titulo}</h2>
      <form
        className="formulario"
        onChange={() => salvar.isSuccess && salvar.reset()}
        onSubmit={(e) => {
          e.preventDefault();
          if (corpo) salvar.mutate(corpo);
        }}
      >
        {children}
        <ErroAcao erro={salvar.error} />
        <div className="pousada__rodape">
          {salvar.isSuccess && <span className="pousada__ok" role="status">Salvo.</span>}
          <Botao type="submit" disabled={!corpo || salvar.isPending}>Salvar</Botao>
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

export function SecaoDados({ config, aoMudarSujo }: { config: ConfigPousada; aoMudarSujo?: (sujo: boolean) => void }) {
  const { v, mudar, salvo } = useEditavel({ razaoSocial: config.razaoSocial, cnpj: config.cnpj, endereco: config.endereco, fuso: config.fuso }, aoMudarSujo);
  const fusos = FUSOS.includes(v.fuso) ? FUSOS : [v.fuso, ...FUSOS];
  return (
    <Secao titulo="Dados" corpo={v} aoSalvo={salvo}>
      <Texto rotulo="Razão social" valor={v.razaoSocial} aoMudar={(razaoSocial) => mudar({ razaoSocial })} />
      <Texto rotulo="CNPJ" valor={v.cnpj} aoMudar={(cnpj) => mudar({ cnpj })} />
      <Texto rotulo="Endereço" valor={v.endereco} aoMudar={(endereco) => mudar({ endereco })} />
      <label className="campo">
        Fuso horário
        <select value={v.fuso} onChange={(e) => mudar({ fuso: e.target.value })}>
          {fusos.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </label>
    </Secao>
  );
}

export function SecaoHorarios({ config, aoMudarSujo }: { config: ConfigPousada; aoMudarSujo?: (sujo: boolean) => void }) {
  const { v, mudar, salvo } = useEditavel({ horaCheckin: config.horaCheckin, horaCheckout: config.horaCheckout, viradaDia: config.viradaDia }, aoMudarSujo);
  const completo = v.horaCheckin !== "" && v.horaCheckout !== "" && v.viradaDia !== "";
  return (
    <Secao titulo="Horários" corpo={completo ? v : null} aoSalvo={salvo}>
      <div className="pousada__grade">
        <Hora rotulo="Check-in" valor={v.horaCheckin} aoMudar={(horaCheckin) => mudar({ horaCheckin })} />
        <Hora rotulo="Check-out" valor={v.horaCheckout} aoMudar={(horaCheckout) => mudar({ horaCheckout })} />
        <Hora rotulo="Virada do dia hoteleiro" valor={v.viradaDia} aoMudar={(viradaDia) => mudar({ viradaDia })} />
      </div>
    </Secao>
  );
}

const percentualInvalido = (r: TaxaEdicao) => r.tipo === "percentual_diaria" && r.valor !== null && !Number.isInteger(r.valor);

/** Taxa de early check-in / late check-out: valor fixo em reais ou percentual (inteiro) da diária. */
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
      {percentualInvalido(regra) && (
        <p role="alert" className="erro-acao">Use um percentual inteiro, sem casas decimais.</p>
      )}
    </fieldset>
  );
}

function SecaoRegras({ config }: { config: ConfigPousada }) {
  const { v, mudar, salvo } = useEditavel({
    exigir: config.sinal.exigir,
    tipoSinal: config.sinal.tipo,
    percentual: String(config.sinal.percentual),
    prazo: String(config.sinal.prazoHoras),
    tolerancia: String(config.sinal.toleranciaHoras),
    early: config.earlyCheckin as TaxaEdicao,
    late: config.lateCheckout as TaxaEdicao,
    idade: String(config.idadeAdulto),
    criancas: String(config.limiteCriancasGratis),
    arredondamento: config.arredondamento,
    frigobar: config.camareiraLancaFrigobar,
  });

  const n = { percentual: lerNumero(v.percentual), prazo: lerNumero(v.prazo), tolerancia: lerNumero(v.tolerancia), idade: lerNumero(v.idade), criancas: lerNumero(v.criancas) };
  const taxaOk = (r: TaxaEdicao) => r.valor !== null && Number.isInteger(r.valor);
  const completo =
    n.percentual !== null && n.prazo !== null && n.tolerancia !== null && n.idade !== null && n.criancas !== null && taxaOk(v.early) && taxaOk(v.late);

  const corpo: Partial<ConfigPousada> | null = completo
    ? {
        sinal: { exigir: v.exigir, tipo: v.tipoSinal, percentual: n.percentual!, prazoHoras: n.prazo!, toleranciaHoras: n.tolerancia! },
        earlyCheckin: v.early as RegraTaxa,
        lateCheckout: v.late as RegraTaxa,
        idadeAdulto: n.idade!,
        limiteCriancasGratis: n.criancas!,
        arredondamento: v.arredondamento,
        camareiraLancaFrigobar: v.frigobar,
      }
    : null;

  return (
    <Secao titulo="Regras" corpo={corpo} aoSalvo={salvo}>
      <fieldset className="pousada__grupo">
        <legend>Sinal</legend>
        <label className="pousada__marcar">
          <input type="checkbox" checked={v.exigir} onChange={(e) => mudar({ exigir: e.target.checked })} />
          Exigir sinal
        </label>
        <div className="pousada__grade">
          <label className="campo">
            Cálculo do sinal
            <select value={v.tipoSinal} onChange={(e) => mudar({ tipoSinal: e.target.value as typeof v.tipoSinal })}>
              <option value="percentual">Percentual do total</option>
              <option value="primeira_diaria">Primeira diária</option>
            </select>
          </label>
          <Numero rotulo="Percentual do sinal (%)" valor={v.percentual} aoMudar={(percentual) => mudar({ percentual })} />
          <Numero rotulo="Prazo do sinal (horas)" valor={v.prazo} aoMudar={(prazo) => mudar({ prazo })} />
          <Numero rotulo="Tolerância do sinal (horas)" valor={v.tolerancia} aoMudar={(tolerancia) => mudar({ tolerancia })} />
        </div>
      </fieldset>
      <div className="pousada__grade">
        <CampoTaxa rotulo="Early check-in" regra={v.early} aoMudar={(early) => mudar({ early })} />
        <CampoTaxa rotulo="Late check-out" regra={v.late} aoMudar={(late) => mudar({ late })} />
      </div>
      <div className="pousada__grade">
        <Numero rotulo="Idade a partir da qual conta como adulto" valor={v.idade} aoMudar={(idade) => mudar({ idade })} />
        <Numero rotulo="Crianças grátis por quarto" valor={v.criancas} aoMudar={(criancas) => mudar({ criancas })} />
        <label className="campo">
          Arredondamento
          <select value={v.arredondamento} onChange={(e) => mudar({ arredondamento: e.target.value as typeof v.arredondamento })}>
            <option value="nenhum">Nenhum</option>
            <option value="real">Real inteiro</option>
          </select>
        </label>
      </div>
      <label className="pousada__marcar">
        <input type="checkbox" checked={v.frigobar} onChange={(e) => mudar({ frigobar: e.target.checked })} />
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
