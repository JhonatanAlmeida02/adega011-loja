import type { Configuracoes, FaixaHorario, Horarios } from "./tipos";

export const FUSO = "America/Sao_Paulo";

export const NOMES_DIAS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

const minutosDe = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** "16:00" -> "16h", "16:30" -> "16h30", "00:00" -> "0h" */
export function formatarHora(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h || 0}h${m ? String(m).padStart(2, "0") : ""}`;
}

/** Dia da semana (0 = domingo) e minutos desde 0h no horário de São Paulo. */
export function agoraEmSP(agora: Date = new Date()): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    dia: dias.indexOf(get("weekday")),
    minutos: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const passaMeiaNoite = (f: FaixaHorario) => minutosDe(f.fecha) <= minutosDe(f.abre);

/** Verifica se o horário (dia/minutos) cai dentro do expediente. */
export function dentroDoHorario(horarios: Horarios, dia: number, minutos: number): FaixaHorario | null {
  for (const f of horarios[String(dia)] ?? []) {
    const abre = minutosDe(f.abre);
    const fecha = minutosDe(f.fecha);
    if (passaMeiaNoite(f) ? minutos >= abre : minutos >= abre && minutos < fecha) return f;
  }
  // Faixa de ontem que atravessou a meia-noite (ex.: sexta 16h–02h, agora é sábado 01h)
  const ontem = (dia + 6) % 7;
  for (const f of horarios[String(ontem)] ?? []) {
    if (passaMeiaNoite(f) && minutos < minutosDe(f.fecha)) return f;
  }
  return null;
}

export interface StatusLoja {
  aberta: boolean;
  /** Ex.: "Aberto agora", "Fechado agora" */
  titulo: string;
  /** Ex.: "Fecha às 2h", "Abre hoje às 16h" */
  detalhe: string;
}

export function statusDaLoja(
  config: Pick<Configuracoes, "horarios" | "status_manual">,
  agora: Date = new Date(),
): StatusLoja {
  if (config.status_manual === "aberta") {
    return { aberta: true, titulo: "Aberto agora", detalhe: "Pode pedir!" };
  }
  const { dia, minutos } = agoraEmSP(agora);
  const faixa = config.status_manual === "fechada" ? null : dentroDoHorario(config.horarios, dia, minutos);

  if (faixa) {
    return {
      aberta: true,
      titulo: "Aberto agora",
      detalhe: faixa.fecha === "00:00" ? "Fecha à meia-noite" : `Fecha às ${formatarHora(faixa.fecha)}`,
    };
  }

  if (config.status_manual === "fechada") {
    return { aberta: false, titulo: "Fechado agora", detalhe: "Voltamos em breve" };
  }

  return { aberta: false, titulo: "Fechado agora", detalhe: proximaAbertura(config.horarios, dia, minutos) };
}

function proximaAbertura(horarios: Horarios, dia: number, minutos: number): string {
  for (let i = 0; i < 7; i++) {
    const d = (dia + i) % 7;
    const faixas = [...(horarios[String(d)] ?? [])].sort((a, b) => minutosDe(a.abre) - minutosDe(b.abre));
    for (const f of faixas) {
      if (i === 0 && minutosDe(f.abre) <= minutos) continue;
      const quando = i === 0 ? "hoje" : i === 1 ? "amanhã" : NOMES_DIAS[d].toLowerCase();
      return `Abre ${quando} às ${formatarHora(f.abre)}`;
    }
  }
  return "Sem horário definido";
}

/** Resumo legível dos horários, agrupando dias iguais. Ex.: "Seg a Qui · 16h–0h" */
export function resumoHorarios(horarios: Horarios): { dias: string; horas: string }[] {
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const curto = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const texto = (d: number) =>
    (horarios[String(d)] ?? []).map((f) => `${formatarHora(f.abre)}–${formatarHora(f.fecha)}`).join(", ") ||
    "Fechado";
  const grupos: { inicio: number; fim: number; horas: string }[] = [];
  for (const d of ordem) {
    const h = texto(d);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.horas === h) ultimo.fim = d;
    else grupos.push({ inicio: d, fim: d, horas: h });
  }
  return grupos.map((g) => ({
    dias: g.inicio === g.fim ? curto[g.inicio] : `${curto[g.inicio]} a ${curto[g.fim]}`,
    horas: g.horas,
  }));
}
