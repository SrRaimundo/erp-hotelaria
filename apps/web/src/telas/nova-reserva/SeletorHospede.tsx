import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { chamarApi } from "../../api/cliente";
import type { Hospede } from "../../api/tipos";
import { Botao } from "../../componentes/Botao";
import { ErroAcao } from "../../componentes/ErroAcao";
import { Janela } from "../../componentes/Janela";
import { useAtrasado } from "../../lib/useAtrasado";
import { CadastroRapidoHospede } from "../reserva/CadastroRapidoHospede";

type Props = { valor: Hospede | null; aoEscolher: (h: Hospede | null) => void };

/** Busca de hóspede (300 ms, mínimo 2 letras) ou cadastro rápido; mostra o titular escolhido. */
export function SeletorHospede({ valor, aoEscolher }: Props) {
  const [texto, setTexto] = useState("");
  const [cadastrando, setCadastrando] = useState(false);
  const termo = useAtrasado(texto.trim(), 300);
  const ativo = termo.length >= 2 && termo === texto.trim();
  const busca = useQuery({
    queryKey: ["hospedes", termo],
    queryFn: () => chamarApi<Hospede[]>("GET", `/api/hospedes?q=${encodeURIComponent(termo)}`),
    enabled: ativo,
    refetchInterval: false,
  });

  if (valor) {
    return (
      <div className="nova-titular">
        <strong>Titular: {valor.nome}</strong>
        {valor.documento && <span className="reserva-suave">{valor.documento}</span>}
        <Botao variante="contorno" tamanho="pequeno" ignorarConexao onClick={() => aoEscolher(null)}>
          Trocar
        </Botao>
      </div>
    );
  }

  return (
    <div className="nova-busca">
      <div className="campo">
        <label htmlFor="nova-busca-hospede">Buscar hóspede</label>
        <input id="nova-busca-hospede" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nome ou documento (mín. 2 letras)" autoComplete="off" />
      </div>
      <ErroAcao erro={busca.error} />
      {ativo && busca.data && busca.data.length === 0 && <p className="reserva-suave">Nenhum hóspede encontrado.</p>}
      {ativo && busca.data && busca.data.length > 0 && (
        <ul className="nova-resultados">
          {busca.data.map((h) => (
            <li key={h.id}>
              <button type="button" className="nova-resultado" onClick={() => aoEscolher(h)}>
                {h.nome}
                {h.documento && <small> — {h.documento}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Botao variante="secundario" tamanho="pequeno" onClick={() => setCadastrando(true)}>
        Cadastrar novo
      </Botao>
      {/* Fora do <form> da reserva: formulário dentro de formulário recarrega a página ao salvar. */}
      {createPortal(
        <Janela aberta={cadastrando} aoFechar={() => setCadastrando(false)} titulo="Cadastrar hóspede">
          <CadastroRapidoHospede
            inicial={texto.trim() ? { nome: texto.trim() } : undefined}
            aoSalvar={(h) => {
              setCadastrando(false);
              aoEscolher(h);
            }}
            aoCancelar={() => setCadastrando(false)}
          />
        </Janela>,
        document.body,
      )}
    </div>
  );
}
