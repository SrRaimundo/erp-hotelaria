export type Data = string; // YYYY-MM-DD

const DIA_MS = 86_400_000;

function paraUtc(d: Data): number {
  const [a, m, dia] = d.split("-").map(Number);
  return Date.UTC(a!, m! - 1, dia!);
}

function deUtc(ms: number): Data {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Maior estadia aceita, em noites. */
export const MAX_NOITES = 365;

/** Dias de a até b (b − a); negativo se b vem antes. */
export function diasEntre(a: Data, b: Data): number {
  return Math.round((paraUtc(b) - paraUtc(a)) / DIA_MS);
}

/** AAAA-MM-DD que existe no calendário (rejeita 2026-02-30, 2026-13-01). */
export function dataValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return deUtc(paraUtc(s)) === s;
}

export function somarDias(d: Data, n: number): Data {
  return deUtc(paraUtc(d) + n * DIA_MS);
}

/** Datas das noites: chegada inclusive, saída exclusiva. */
export function noites(chegada: Data, saida: Data): Data[] {
  const r: Data[] = [];
  for (let d = chegada; d < saida; d = somarDias(d, 1)) r.push(d);
  return r;
}

export function diaDaSemana(d: Data): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(paraUtc(d)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function dataLocal(instante: Date, fuso: string): Data {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

export function horaLocal(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const h = partes.find((p) => p.type === "hour")!.value;
  const m = partes.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

/** Dia hoteleiro: antes do horário de virada (HH:MM local), vale o dia anterior. */
export function diaHoteleiro(instante: Date, fuso: string, virada: string): Data {
  const hora = horaLocal(instante, fuso);
  const data = dataLocal(instante, fuso);
  return hora < virada ? somarDias(data, -1) : data;
}

export function idadeEm(nascimento: Data, em: Data): number {
  const [an, mn, dn] = nascimento.split("-").map(Number);
  const [ae, me, de] = em.split("-").map(Number);
  let idade = ae! - an!;
  if (me! < mn! || (me === mn && de! < dn!)) idade--;
  return idade;
}
