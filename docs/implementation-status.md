# WMS · Situação da implementação

Atualizado em 17/11/2026. Branch: `claude/new-session-p9kpgj`.

**O WMS NÃO está pronto para produção.** Falta homologar a integração com a conta Olist, validar a política de lançamento de estoque por depósito, testar com equipamentos reais, fazer teste de carga e o piloto operacional (seções 15–17 do guia).

Legenda: **Implementado** = código existe e roda · **Testado** = coberto por teste automatizado executado nesta entrega (resultado real abaixo) · **Simulado** = funciona só com o simulador do ERP · **Pendente** = não feito ou depende de decisão/credencial/equipamento.

## Decisões de arquitetura (e por quê)

| Decisão | Motivo |
|---|---|
| WMS dentro do app Next.js existente (`/wms`, `/api/wms`), sem mexer na loja | O repositório já era Next 16 + Supabase; um monólito modular evita duplicar build, auth e deploy. A loja (`/`, `/admin`) continua igual |
| Schema PostgreSQL próprio `wms` (não exposto pelo PostgREST) | Isola do schema `public` da loja e impede acesso direto pelo navegador; o backend fala com o banco por conexão transacional |
| Comandos críticos como funções SQL `SECURITY DEFINER` | Transação única com travas determinísticas, revalidação de permissão/escopo/versão, ledger + projeção + reserva + auditoria + outbox juntos |
| Backend conecta com `DATABASE_URL` e faz `set_config('role','authenticated')` + claims do JWT verificado | Mesmo modelo do PostgREST: RLS e `auth.uid()` valem nas leituras; nada de chave privilegiada para operações de usuário |
| Worker em processo separado (`npm run wms:worker`) com papel `wms_worker` | Nenhuma transação aberta durante chamada ao ERP; lease e retomada |
| Estoque da loja (`public.produtos.estoque`) **não** é ligado ao WMS | Ligar os dois sem política validada criaria baixa dupla. Fica como decisão pendente |
| Rotas de detalhe com `?id=` (ex.: `/wms/pedidos/detalhe?id=`) | O prerender do Next 16 (Cache Components) bloqueava as rotas `[id]` desta árvore; páginas estáticas com `useSearchParams` resolvem sem perder nada num sistema interno |

## Etapa 0 — Fundação e contratos

| Item | Situação |
|---|---|
| Inspeção do repositório e branch isolada | Implementado |
| Migrations versionadas (`supabase/migrations/20261117190000_wms_01` … `191000_wms_11`) | Implementado e testado (aplicadas do zero em PostgreSQL 16 local) |
| Script de banco local de teste (`scripts/wms-db-local.sh`) com *shim* do Supabase (`tests/wms/sql/00_supabase_shim.sql`) | Implementado. O shim **não** vai para o Supabase real |
| Lint, typecheck, build | Executados: lint sem erros (2 avisos intencionais de `location.href` após sair/sessão expirada), typecheck ok, `npm run build` ok |
| CI | Implementado: job `wms-banco` em `.github/workflows/ci.yml` (PostgreSQL 16, testes do banco e e2e do WMS). **Ainda não executado no GitHub Actions** |
| Mock Olist e matriz de capacidades | Implementado: `MockOlistAdapter`; `docs/olist-capabilities.md` |
| Contrato da API interna | `docs/wms/openapi.json` gerado do registro de rotas (`npx tsx scripts/wms-openapi.ts`) |

## Etapa 1 — Acesso, cadastros e estoque

| Item | Situação |
|---|---|
| Login e-mail/senha (Supabase Auth), sessões individuais, "Sair" visível | Implementado; testado no e2e com Auth **falso** (não com Supabase real) |
| Convite de usuário (`/api/wms/admin/members/invite`) | Implementado; **não testado** (precisa da chave secreta de um projeto Supabase) |
| MFA (TOTP): cadastro em `/wms/conta`, desafio no login, exigido no servidor para `admin.settings`, `users.manage`, `integrations.manage`, `inventory.approve` | Exigência no banco testada (`aal` do JWT). Telas de cadastro/desafio **não testadas** com Supabase real |
| Bootstrap do primeiro admin sem senha em seed (`npm run wms:bootstrap`) | Implementado; função SQL testada (helpers dos testes) |
| RBAC granular (38 permissões, 8 perfis) com escopo empresa/armazém; vínculo ativo consultado em toda operação | Implementado e testado |
| RLS em todas as tabelas `wms.*`, sem INSERT/UPDATE/DELETE para o app | Testado (`contratos.test.ts`, `seguranca.test.ts`) |
| Armazéns (com endereços técnicos padrão), zonas, endereços (tipo, capacidade, bloqueio, picking) | Implementado e testado |
| Produtos, unidades com fator, códigos de barras (texto, zeros à esquerda), kits (componentes/montado), lote/validade/série | Implementado e testado |
| Ledger imutável + projeção de saldo na mesma transação; reconstrução/conferência (`check_balances_against_ledger`) | Testado (invariantes conferidas ao fim dos fluxos) |
| Reserva concorrente (FEFO, sem vencido/abaixo da validade mínima, sem bloqueado/quarentena/inventário) | Testado com 20 reservas simultâneas pela última unidade |
| Correção por movimento inverso vinculado | Testado |
| Integração de leitura (produtos, depósitos, pedidos, ordem de compra, estoque) | Implementado; **Simulado** (V3 só com testes unitários sobre o formato documentado) |
| Carga inicial por endereço via inventário `initial_load` com aprovação | Testado |

## Etapa 2 — Primeiro fluxo completo

| Item | Situação |
|---|---|
| Recebimento: previsão manual/ERP, conferência por leitura, parcial, sobra com aprovação, avaria para quarentena, recusa, encerramento com falta, origem duplicada barrada | Testado (banco e navegador) |
| Armazenagem sugerida por produto/zona/capacidade, confirmação origem → produto → destino | Testado (banco e navegador) |
| Pedido → reserva → tarefas por zona → separação por leitura → staging (reserva acompanha) | Testado (banco e navegador) |
| Falta na separação → ocorrência → realocação autorizada | Testado |
| Código ambíguo exige escolha (servidor devolve candidatos) | Implementado no banco e na tela; **sem teste dedicado** |
| Conferência por leitura, volumes, divergência bloqueia fechamento | Testado |
| Etiqueta interna e reimpressão auditada sem nova remessa/baixa | Testado |
| Remessa, leitura de todos os volumes, despacho explícito com liberação fiscal por política | Testado (banco e navegador) |
| Cancelamento antes/durante/depois da separação; cancelamento vindo do ERP | Testado |
| Pedido alterado no ERP após reserva → espera + tarefas invalidadas → reconciliação | Testado |
| Outbox/inbox, lease, retomada, verificação após queda, desconhecido, falha permanente, 429/backoff, limite compartilhado, refresh serializado, reautorização | Testado **com o simulador** |
| Política única de lançamento por depósito (`erp_on_invoice` / `wms_on_dispatch` / `erp_on_document` / `wms_on_receipt`) | Implementado e testado no simulador. **Nenhuma política validada com a conta real** |
| Painel de integração (filas, reprocessar com proteção, mapear depósitos, política) | Implementado; **sem teste e2e** |

## Etapa 3 — WMS completo

| Item | Situação |
|---|---|
| Inventário: contagem cega, bloqueio de endereços, recontagem por tolerância, aprovação distinta com MFA, aprovação repetida não reaplica, cancelamento libera | Testado |
| Inventário por número de série | **Pendente** (recusado com erro explícito `serial_inventory_pending`) |
| Inventário com snapshot e compensação (sem bloquear endereço) | **Pendente** (fora do primeiro lançamento, conforme o guia) |
| Devoluções vinculadas ao pedido (limite pelo expedido), quarentena, decisão de qualidade (reintegrar, reparo, descarte, fornecedor) | Testado (reintegração); descarte/fornecedor implementados, **sem teste dedicado** |
| Transferência entre armazéns com trânsito e encerramento com divergência | Testado |
| Transferência de produto com série entre armazéns | **Pendente** (recusado com erro explícito) |
| Reabastecimento por mínimo/máximo | Testado |
| Ondas e tarefas por zona | Implementado; ondas **sem teste dedicado** |
| Cross docking | **Pendente** (não implementado: exige regra para reservar estoque ainda em recebimento sem pular conferência) |
| Indicadores (com período, unidade, denominador, sem divisão por zero) | Implementado; **sem teste dedicado**. Produtividade não desconta pausas (pendente) |
| Expedição parcial | **Desabilitada** de propósito (constraint no banco) até validar contrato e regra |
| Impressão homologada com equipamento, balança, coletores reais | **Pendente** (impressão via janela do navegador; peso informado manualmente) |
| Etiqueta de transportadora | **Pendente** (depende de recurso homologado no ERP) |
| Upload de evidências (bucket privado `wms-evidencias`, política por empresa/armazém) | Política de Storage e predicado implementados (predicado testado); **tela de upload pendente** |

## Etapa 4 — Implantação (tudo pendente)

Teste de carga com volume representativo, inventário/carga inicial real, homologação Olist, treinamento, piloto, definição de RPO/RTO e teste de restauração.

## Testes executados nesta entrega (resultados reais)

| Suíte | Comando | Resultado |
|---|---|---|
| Banco/concorrência/segurança/integração (PostgreSQL 16 local) | `WMS_TEST_DATABASE_URL=... npm run test:wms` | **44 de 44 passaram** |
| Unitários (loja + WMS) | `npm run test:unit` | **66 de 66 passaram** (54 já existiam) |
| Ponta a ponta do WMS no navegador (Next dev + PostgreSQL + Auth falso) | `WMS_TEST_DATABASE_URL=... npm run test:e2e:wms` | **2 de 2 passaram** |
| E2E existente da loja (modo demonstração) | `npm run test:e2e` | **55 passaram, 17 pulados** (pulos são da própria suíte por dispositivo), 0 falhas |
| Lint / typecheck / build | `npm run lint`, `npm run typecheck`, `npm run build` | ok (2 avisos de lint) |

Cenários obrigatórios da seção 16 do guia e onde estão cobertos:

| Cenário | Teste |
|---|---|
| Duas reservas disputam a última unidade | `concorrencia.test.ts` (20 simultâneas, 1 confirma) |
| Mesma chave repete resultado / payload diferente conflita | `fluxos.test.ts`, `concorrencia.test.ts` |
| Transferência interna preserva total com duas partidas | `fluxos.test.ts` |
| Recebimento parcial | `fluxos.test.ts` |
| Vencido/quarentena bloqueados | `fluxos.test.ts` |
| Série duplicada | `fluxos.test.ts` |
| Caixa fator 12 | `fluxos.test.ts` e e2e |
| Cancelamento durante picking | `fluxos.test.ts`, `integracao.test.ts` |
| Pedido alterado após reserva | `integracao.test.ts` |
| Webhook repetido / fora de ordem | `integracao.test.ts` |
| ERP baixou no faturamento → sem segunda baixa | `integracao.test.ts` |
| Timeout após escrita | `integracao.test.ts` |
| Worker cai após enviar | `integracao.test.ts` |
| Refresh simultâneo | `integracao.test.ts` |
| API indisponível / 429 | `integracao.test.ts` |
| Inventário ativo bloqueia movimento | `concorrencia.test.ts` |
| Autoaprovação negada | `seguranca.test.ts` |
| Sem armazém/empresa, inclusive por ID direto | `seguranca.test.ts` e e2e |
| Desativado com JWT válido | `seguranca.test.ts` |
| Papel enviado pelo cliente | `seguranca.test.ts` |
| Arquivo de outra empresa | `seguranca.test.ts` (predicado da política; Storage real não testado) |
| Reimpressão sem nova baixa | `fluxos.test.ts` |
| Restaurar backup | **Pendente** (procedimento em `docs/wms/procedimentos.md`, não executado) |

## Não validado (sem credenciais/equipamentos)

- Qualquer chamada real à Olist (OAuth, leitura, escrita, webhooks, limites reais).
- Supabase Auth real: convite, MFA (enroll/challenge), validação de JWT com chaves assimétricas, cookies em produção, Storage.
- Aplicação das migrations num projeto Supabase real (o `postgres` do Supabase não é superusuário: os `GRANT`/`SET ROLE` foram escritos para isso, mas não foram executados lá).
- Coletores, leitores, impressoras e balança.
- Desempenho com volume real.

## Próximos passos sugeridos

1. Aplicar as migrations num projeto Supabase de **homologação** e rodar `npm run test:wms` contra ele.
2. Criar o aplicativo privado na Olist, autorizar uma conta de teste e preencher a homologação interna em `docs/olist-capabilities.md`, começando pelas leituras.
3. Decidir com a empresa: situações elegíveis, política de lançamento por depósito, origem do custo para `precoUnitario` (ou usar o lançamento por pedido) e liberação fiscal.
4. Inventário/carga inicial do armazém piloto e piloto limitado.
