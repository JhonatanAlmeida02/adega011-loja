/** Sobe o Auth falso como processo próprio (webServer do Playwright). Só para testes. */
import { AuthFalso } from "./auth-falso";

const porta = Number(process.env.PORTA_AUTH_FALSO ?? 54399);
void new AuthFalso(porta).iniciar().then(() => console.log(`Auth falso em http://127.0.0.1:${porta}`));
