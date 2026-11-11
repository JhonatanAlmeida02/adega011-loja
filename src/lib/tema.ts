/**
 * Tema claro/escuro da Adega011.
 * O tema fica no atributo data-tema do <html> e a escolha é guardada no aparelho.
 * Padrão: escuro em grafite. Sem escolha salva, segue o escuro.
 */
export type Tema = "claro" | "escuro";

export const CHAVE_TEMA = "adega011-tema";
export const COR_BARRA: Record<Tema, string> = { escuro: "#323232", claro: "#FFFFFF" };

/**
 * Roda no <head> antes da pintura, para a página já abrir no tema certo
 * (sem "piscar" escuro antes do claro).
 */
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});if(t!=="claro")t="escuro";var d=document.documentElement;d.dataset.tema=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="claro"?${JSON.stringify(COR_BARRA.claro)}:${JSON.stringify(COR_BARRA.escuro)});}catch(e){document.documentElement.dataset.tema="escuro";}})();`;

export function temaAtual(): Tema {
  if (typeof document === "undefined") return "escuro";
  return document.documentElement.dataset.tema === "claro" ? "claro" : "escuro";
}

export function aplicarTema(tema: Tema) {
  document.documentElement.dataset.tema = tema;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", COR_BARRA[tema]));
  try {
    localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    /* navegação privada: vale só nesta visita */
  }
}
