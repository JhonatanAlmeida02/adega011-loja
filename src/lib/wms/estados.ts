/**
 * Estados e transições por domínio (espelho da tabela wms.state_transitions,
 * que é quem de fato bloqueia no banco). Um teste compara os dois.
 * Estados fiscal, de integração e de execução são independentes.
 */

export const TRANSICOES: Record<string, Record<string, string[]>> = {
  order: {
    awaiting_allocation: ["allocated", "on_hold", "cancelled"],
    allocated: ["picking", "on_hold", "cancelled"],
    picking: ["picked", "on_hold", "cancelled"],
    picked: ["checking", "on_hold", "cancelled"],
    checking: ["packed", "on_hold", "cancelled"],
    packed: ["ready_to_dispatch", "on_hold", "cancelled"],
    ready_to_dispatch: ["dispatched", "packed", "on_hold", "cancelled"],
    on_hold: ["awaiting_allocation", "allocated", "picking", "picked", "checking", "packed", "ready_to_dispatch", "cancelled"],
  },
  receipt: {
    expected: ["receiving", "cancelled"],
    receiving: ["awaiting_review", "partially_received", "received", "cancelled"],
    awaiting_review: ["receiving", "partially_received", "received"],
    partially_received: ["receiving", "awaiting_review", "received"],
  },
  picking_task: {
    open: ["in_progress", "completed", "cancelled", "invalidated"],
    in_progress: ["completed", "cancelled", "invalidated"],
  },
  inventory: {
    draft: ["counting", "cancelled"],
    counting: ["review", "cancelled"],
    review: ["closed", "cancelled"],
  },
  shipment: {
    open: ["loading", "cancelled"],
    loading: ["dispatched", "open", "cancelled"],
  },
  transfer: {
    draft: ["in_transit", "cancelled"],
    in_transit: ["received", "closed_with_discrepancy"],
  },
  return: {
    expected: ["receiving", "cancelled"],
    receiving: ["inspection", "closed"],
    inspection: ["closed"],
  },
};

export function podeTransitar(dominio: string, de: string, para: string): boolean {
  return de === para || (TRANSICOES[dominio]?.[de] ?? []).includes(para);
}

export const ROTULOS: Record<string, string> = {
  awaiting_allocation: "Aguardando reserva",
  allocated: "Reservado",
  picking: "Em separação",
  picked: "Separado",
  checking: "Em conferência",
  packed: "Embalado",
  ready_to_dispatch: "Pronto para expedir",
  partially_dispatched: "Expedido parcialmente",
  dispatched: "Expedido",
  on_hold: "Em espera",
  cancelled: "Cancelado",
  expected: "Previsto",
  receiving: "Em conferência",
  awaiting_review: "Aguardando supervisor",
  partially_received: "Recebido parcialmente",
  received: "Recebido",
  open: "Aberta",
  in_progress: "Em andamento",
  completed: "Concluída",
  invalidated: "Invalidada",
  draft: "Rascunho",
  counting: "Em contagem",
  review: "Em aprovação",
  closed: "Encerrado",
  loading: "Carregando",
  in_transit: "Em trânsito",
  closed_with_discrepancy: "Encerrada com divergência",
  inspection: "Em inspeção",
  pending: "Pendente ERP",
  processing: "Enviando",
  sent: "Confirmado no ERP",
  failed: "Erro ERP",
  unknown: "Resultado desconhecido",
  blocked: "Bloqueado",
  released: "Liberado",
  not_required: "Não exigido",
  applied: "Aplicado",
  rejected: "Rejeitado",
  available: "Disponível",
  quarantine: "Quarentena",
  damaged: "Avariado",
  active: "Ativo",
  reauthorization_required: "Reautorização necessária",
  pending_authorization: "Aguardando autorização",
  paused: "Pausada",
};

export const rotulo = (s: string | null | undefined) => (s ? (ROTULOS[s] ?? s) : "—");
