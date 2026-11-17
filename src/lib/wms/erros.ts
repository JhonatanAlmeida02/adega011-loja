/**
 * Erros do WMS com status HTTP. As funções do banco usam SQLSTATE próprios
 * (WA401, WA403, WA404, WA409, WA422); aqui viram respostas seguras.
 */
export class WmsErro extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public detalhe?: string,
    public dados?: unknown,
  ) {
    super(mensagem);
    this.name = "WmsErro";
  }
}

type ErroPg = { code?: string; message?: string; detail?: string; hint?: string };

const STATUS_POR_SQLSTATE: Record<string, number> = {
  WA401: 401,
  WA403: 403,
  WA404: 404,
  WA409: 409,
  WA422: 422,
  "23514": 409, // check_violation: saldo/reserva
  "23505": 409, // unique_violation
  "23503": 422, // foreign_key_violation (referência inválida/de outra empresa)
  "22P02": 422, // texto inválido (ex.: uuid malformado)
  "22007": 422, // data inválida
  "22003": 422, // número fora do intervalo
  "42501": 403, // sem privilégio no banco
  "40001": 409, // falha de serialização após retentativas
  "40P01": 409, // deadlock após retentativas
};

/** Converte erro do PostgreSQL em WmsErro (mensagem pt-BR do banco só para códigos do domínio). */
export function traduzirErroPg(e: unknown): WmsErro {
  if (e instanceof WmsErro) return e;
  const pg = (e ?? {}) as ErroPg;
  const code = pg.code ?? "";
  const status = STATUS_POR_SQLSTATE[code];
  if (!status) {
    // Log estruturado só com código e mensagem do banco (sem parâmetros, tokens ou payloads).
    console.error(JSON.stringify({ nivel: "erro", origem: "wms.db", sqlstate: code || null, mensagem: pg.message ?? String(e) }));
    return new WmsErro(500, "erro_interno", "Erro interno. Tente novamente ou acione o suporte com o código de correlação.");
  }
  const dominio = code.startsWith("WA");
  let dados: unknown;
  if (dominio && pg.hint) {
    try {
      dados = JSON.parse(pg.hint);
    } catch {
      dados = undefined;
    }
  }
  const mensagem = dominio
    ? (pg.message ?? "Operação recusada.")
    : code === "23505"
      ? "Registro duplicado."
      : code === "23514"
        ? "Operação deixaria saldo ou reserva inválidos."
        : code === "40001" || code === "40P01"
          ? "Conflito de concorrência. Tente novamente."
          : "Dados inválidos.";
  return new WmsErro(status, dominio ? (pg.detail ?? code) : code, mensagem, dominio ? pg.detail : undefined, dados);
}

export function ehErroRetentavel(e: unknown): boolean {
  const code = (e as ErroPg | undefined)?.code;
  return code === "40001" || code === "40P01";
}
