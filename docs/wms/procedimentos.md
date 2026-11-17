# WMS · Procedimentos: erros, reprocessamento, conciliação, backup e restauração

## Estados de um evento de integração (outbox)

| Estado | Significa | O que fazer |
|---|---|---|
| `pending` | Na fila; o worker tenta quando chegar a hora (backoff) | Nada. Se não sai, veja se a conexão está ativa e com escrita habilitada |
| `processing` | Com um worker (lease) | Nada. Se o worker cair, outro retoma ao fim do lease **verificando antes de reenviar** |
| `sent` | Confirmado pelo ERP (referência do lançamento guardada) | — |
| `failed` | Erro permanente (validação, produto sem ID externo) ou tentativas esgotadas | Corrija a causa e **Reprocessar**, ou **Cancelar** com justificativa |
| `unknown` | Resultado desconhecido (timeout/5xx depois de enviar) | **Não reenvie às cegas.** Procure o lançamento no ERP (a observação contém `WMS <id do movimento>`). Achou: **Já aplicado no ERP**. Não achou: **Reprocessar** registrando a verificação |
| `blocked` | Política de lançamento não validada, fluxo sem contrato validado ou falta de custo unitário | Defina/valide a política. Depois **Reprocessar** (se o WMS deve lançar) ou **Cancelar** (se o ERP já lança) |

Inbox (avisos/consultas): `failed` com "depósito não mapeado" → mapeie o depósito e **Reprocessar**. "Produto não sincronizado" é tentado de novo sozinho depois de uma importação de produtos.

## Conexão exige reautorização

Refresh recusado ou token revogado deixa a conexão em `reauthorization_required` e o worker para de usá-la (jobs e filas ficam preservados). Em **Integrações**, clique em **Reautorizar na Olist**. O health check `/api/wms-saude` responde 503 enquanto isso.

## Conciliação ERP × WMS

**Integrações → Conciliar estoque** compara, por produto e depósito mapeado, o saldo do ERP com o físico do WMS, descontando lançamentos ainda não confirmados. Diferença vira ocorrência `erp_stock_mismatch` (atualizada a cada conciliação). O ledger físico **nunca** é sobrescrito. Causas comuns: lançamento manual no ERP, política de lançamento errada, evento `unknown`/`blocked` antigo, inventário aprovado (ajuste ainda sem fluxo de envio).

## Correções de estoque

- Movimento confirmado não é editado nem apagado (bloqueado no banco). Use **Reverter** (transferência, armazenagem, mudança de condição) — cria movimento inverso vinculado.
- Diferença física: faça inventário do endereço (aprovação por outro supervisor).
- Conferência da projeção: `select * from wms.check_balances_against_ledger('<armazém>')` e `wms.check_reservations_against_balances('<armazém>')` devem voltar vazias. `wms.rebuild_balances('<armazém>')` reconstrói a quantidade a partir do ledger (uso de manutenção, papel dono do banco).

## Backup (proposta a validar com a empresa)

| Item | Proposta | Observação |
|---|---|---|
| PostgreSQL | Backups gerenciados do Supabase + PITR no plano que oferecer | Defina RPO (perda máxima aceitável) e RTO (tempo para voltar) |
| Storage (`wms-evidencias`) | Cópia periódica dos objetos para outro destino | **Backup do banco não inclui os arquivos** |
| Configuração | Variáveis de ambiente e chaves de cifragem guardadas em cofre | Sem a `INTEGRATION_ENCRYPTION_KEY` os tokens não abrem (reautorize) |
| Retenção | A definir (auditoria e evidências podem ter exigência legal) | — |

Teste a restauração em homologação antes do go-live e registre o tempo real.

## Restauração

1. **Pause as escritas externas**: em cada conexão, **Pausar** e **Desabilitar escrita**; pare o worker.
2. Restaure o banco (e os arquivos, se for o caso) no ponto escolhido.
3. Uma restauração pode **reintroduzir eventos já enviados** ao ERP. Antes de religar: para cada evento `pending/processing/unknown` com data depois do ponto restaurado, verifique no ERP e marque **Já aplicado** ou **Cancelar**.
4. Rode a conciliação e trate as ocorrências.
5. Só então habilite escrita, retome as conexões e o worker.

## Incidente

1. Pause escritas externas (conexão pausada / escrita desabilitada / `OLIST_WRITE_ENABLED=false`).
2. Preserve outbox, inbox, ledger e auditoria (não apague nada).
3. Diagnostique pelos `correlation_id` (aparecem nas mensagens de erro da tela, nos logs e em `integration_attempts`).
4. Concilie antes de retomar.

Rollback de código **não** desfaz movimentação física nem fiscal já executada: corrija com os fluxos de devolução, inventário ou reversão.

## Antes do go-live

- Inventário/carga inicial aprovado do armazém piloto.
- Depósitos mapeados e políticas validadas e registradas.
- Gatilhos automáticos do ERP revisados (baixa no faturamento, lançamento pela nota).
- Jobs e eventos antigos tratados; ponto de corte registrado.
- MFA cadastrado por todos os supervisores e administradores.
- Aceite dos responsáveis registrado.
