/** Marcador das telas de Configurações que ainda serão construídas (tarefas 7 a 9). */
export function EmConstrucao({ titulo }: { titulo: string }) {
  return (
    <section>
      <h1>{titulo}</h1>
      <p className="lista-cadastro__vazio">Em construção.</p>
    </section>
  );
}
