import type { Configuracoes, FaixaHorario, Horarios, StatusManual } from "./tipos";

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

type ConfigStatus = Pick<Configuracoes, "horarios" | "status_manual"> & { status_ate?: string | null };

/**
 * Modo que vale agora. "Forçar aberta/fechada" pode ter prazo (status_ate):
 * passou do prazo, volta sozinho ao automático (pelos horários padrão).
 * Sem prazo, vale até alguém mudar no painel.
 */
export function modoEfetivo(config: Pick<ConfigStatus, "status_manual" | "status_ate">, agora: Date = new Date()): StatusManual {
  if (config.status_manual !== "auto" && config.status_ate && new Date(config.status_ate).getTime() <= agora.getTime()) {
    return "auto";
  }
  return config.status_manual;
}

/** `agora` + n minutos, com segundos zerados (os horários são por minuto). */
const daquiA = (agora: Date, minutos: number) => new Date(Math.floor(agora.getTime() / 60_000) * 60_000 + minutos * 60_000);

/** Próxima abertura pelos horários padrão, depois de agora (null se não há horário). */
export function proximaAberturaEm(horarios: Horarios, agora: Date = new Date()): Date | null {
  const { dia, minutos } = agoraEmSP(agora);
  let melhor: number | null = null;
  for (let i = 0; i <= 7; i++) {
    for (const f of horarios[String((dia + i) % 7)] ?? []) {
      const diferenca = i * 1440 + minutosDe(f.abre) - minutos;
      if (diferenca > 0 && (melhor === null || diferenca < melhor)) melhor = diferenca;
    }
  }
  return melhor === null ? null : daquiA(agora, melhor);
}

/** Próxima vez que o relógio de São Paulo marca "HH:MM" (hoje ou amanhã). */
export function proximaHora(hhmm: string, agora: Date = new Date()): Date {
  const { minutos } = agoraEmSP(agora);
  return daquiA(agora, (minutosDe(hhmm) - minutos + 1440) % 1440 || 1440);
}

/** Hora de uma data no fuso de São Paulo: "2h", "16h30". */
export function horaEmSP(data: Date): string {
  const { minutos } = agoraEmSP(data);
  return formatarHora(`${Math.floor(minutos / 60)}:${minutos % 60}`);
}

/** "hoje às 16h", "amanhã às 2h", "segunda às 16h" (fuso de São Paulo). */
export function quandoEmSP(alvo: Date, agora: Date = new Date()): string {
  const a = agoraEmSP(agora);
  const b = agoraEmSP(alvo);
  const dias = Math.floor((a.minutos + Math.round((alvo.getTime() - agora.getTime()) / 60_000)) / 1440);
  const dia = dias <= 0 ? "hoje" : dias === 1 ? "amanhã" : dias < 7 ? NOMES_DIAS[b.dia].toLowerCase() : null;
  const hora = horaEmSP(alvo);
  if (dia) return `${dia} às ${hora}`;
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(alvo);
  return `${data} às ${hora}`;
}

/** Até quando vale o modo forçado (null se não há prazo ou ele já passou). */
export function prazoDoModo(config: Pick<ConfigStatus, "status_manual" | "status_ate">, agora: Date = new Date()): Date | null {
  if (modoEfetivo(config, agora) === "auto" || !config.status_ate) return null;
  return new Date(config.status_ate);
}

export function statusDaLoja(config: ConfigStatus, agora: Date = new Date()): StatusLoja {
  const modo = modoEfetivo(config, agora);
  const prazo = prazoDoModo(config, agora);

  if (modo === "aberta") {
    if (!prazo) return { aberta: true, titulo: "Aberto agora", detalhe: "Pode pedir!" };
    // Se no fim do prazo o horário normal já está aberto, a loja segue aberta até ele fechar.
    const p = agoraEmSP(prazo);
    const seguida = dentroDoHorario(config.horarios, p.dia, p.minutos);
    if (seguida) return { aberta: true, titulo: "Aberto agora", detalhe: textoFecha(seguida) };
    return { aberta: true, titulo: "Aberto agora", detalhe: `Aberto até ${horaEmSP(prazo)}` };
  }

  const { dia, minutos } = agoraEmSP(agora);
  if (modo === "fechada") {
    return { aberta: false, titulo: "Fechado agora", detalhe: prazo ? `Abre ${quandoEmSP(prazo, agora)}` : "Voltamos em breve" };
  }

  const faixa = dentroDoHorario(config.horarios, dia, minutos);
  if (faixa) return { aberta: true, titulo: "Aberto agora", detalhe: textoFecha(faixa) };
  return { aberta: false, titulo: "Fechado agora", detalhe: proximaAbertura(config.horarios, dia, minutos) };
}

const textoFecha = (f: FaixaHorario) => (f.fecha === "00:00" ? "Fecha à meia-noite" : `Fecha às ${formatarHora(f.fecha)}`);

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
