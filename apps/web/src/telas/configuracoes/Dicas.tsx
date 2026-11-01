/** Motivos pelos quais o botão de salvar está desligado, ditos ao usuário. */
export function Dicas({ motivos }: { motivos: string[] }) {
  if (motivos.length === 0) return null;
  return (
    <ul className="cq__aviso cq__dicas">
      {motivos.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}
