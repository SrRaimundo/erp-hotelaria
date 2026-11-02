/** YYYY-MM-DD → dd/mm/aaaa (só para textos do servidor, como o subtítulo). */
export const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
