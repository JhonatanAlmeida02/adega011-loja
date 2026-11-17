-- =====================================================================
-- WMS · 10 · Integração (ERP Olist): conexões, políticas, fila e worker
-- Funções worker_* rodam com o papel `wms_worker` (sem usuário final).
-- Webhook é sinal NÃO confiável (a documentação oficial não descreve
-- assinatura): o worker consulta o registro autenticado antes de mutar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Administração (usuário com integrations.manage + MFA)
-- ---------------------------------------------------------------------
create or replace function wms.create_connection(p_org uuid, p_name text, p_adapter text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; v_id uuid; v_ref text; v_result jsonb;
begin
  perform wms.require(p_org, 'integrations.manage');
  v_replay := wms._idem_begin(p_org, 'create_connection', p_key, jsonb_build_object('n', p_name, 'a', p_adapter));
  if v_replay is not null then return v_replay; end if;
  insert into wms.integration_connections (organization_id, name, adapter, status, settings)
  values (p_org, coalesce(nullif(trim(p_name), ''), 'Olist ERP'), coalesce(p_adapter, 'mock'),
          case when coalesce(p_adapter, 'mock') = 'mock' then 'active' else 'pending_authorization' end,
          jsonb_build_object('cancelled_order_statuses', jsonb_build_array('2')))
  returning id, webhook_ref into v_id, v_ref;
  perform wms._audit(p_org, null, 'connection_created', 'integration_connection', v_id::text, jsonb_build_object('adapter', p_adapter));
  v_result := jsonb_build_object('connection_id', v_id, 'webhook_ref', v_ref);
  return wms._idem_finish(p_org, p_key, v_result);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Adaptador inválido.';
end;
$$;

create or replace function wms.update_connection(
  p_connection uuid, p_eligible_statuses text[], p_cancelled_statuses text[], p_write_enabled boolean, p_paused boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if not found then raise exception using errcode = 'WA404', message = 'Conexão não encontrada.'; end if;
  perform wms.require(v_c.organization_id, 'integrations.manage');
  update wms.integration_connections set
    eligible_order_statuses = coalesce(p_eligible_statuses, eligible_order_statuses),
    settings = case when p_cancelled_statuses is null then settings
                    else settings || jsonb_build_object('cancelled_order_statuses', to_jsonb(p_cancelled_statuses)) end,
    write_enabled = coalesce(p_write_enabled, write_enabled),
    status = case when p_paused is true and status = 'active' then 'paused'
                  when p_paused is false and status = 'paused' then 'active' else status end,
    updated_at = now()
   where id = p_connection;
  perform wms._audit(v_c.organization_id, null, 'connection_updated', 'integration_connection', p_connection::text,
    jsonb_build_object('eligible', p_eligible_statuses, 'cancelled', p_cancelled_statuses, 'write_enabled', p_write_enabled, 'paused', p_paused));
  return jsonb_build_object('connection_id', p_connection);
end;
$$;

-- Guarda o state (hash) e o verificador PKCE cifrado da autorização OAuth iniciada pelo administrador.
create or replace function wms.begin_oauth(p_connection uuid, p_state_hash text, p_pkce_ciphertext text, p_ttl_seconds integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections; v_uid uuid;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if not found then raise exception using errcode = 'WA404', message = 'Conexão não encontrada.'; end if;
  v_uid := wms.require(v_c.organization_id, 'integrations.manage');
  if v_c.adapter <> 'olist_v3' then
    raise exception using errcode = 'WA409', message = 'Conexão simulada não usa OAuth.';
  end if;
  update wms.integration_connections set oauth_state_hash = p_state_hash, oauth_pkce_ciphertext = p_pkce_ciphertext,
         oauth_state_expires_at = now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 900)),
         oauth_started_by = v_uid, updated_at = now()
   where id = p_connection;
  perform wms._audit(v_c.organization_id, null, 'oauth_started', 'integration_connection', p_connection::text, '{}'::jsonb);
  return jsonb_build_object('connection_id', p_connection);
end;
$$;

create or replace function wms.map_deposit(p_connection uuid, p_external_id text, p_wh uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if not found then raise exception using errcode = 'WA404', message = 'Conexão não encontrada.'; end if;
  perform wms.require(v_c.organization_id, 'integrations.manage');
  update wms.erp_deposits set warehouse_id = p_wh, updated_at = now() where connection_id = p_connection and external_id = p_external_id;
  if not found then raise exception using errcode = 'WA404', message = 'Depósito do ERP não importado.'; end if;
  insert into wms.stock_posting_policies (organization_id, connection_id, warehouse_id)
  values (v_c.organization_id, p_connection, p_wh) on conflict do nothing;
  perform wms._audit(v_c.organization_id, p_wh, 'deposit_mapped', 'erp_deposit', p_external_id, jsonb_build_object('warehouse_id', p_wh));
  return jsonb_build_object('connection_id', p_connection, 'external_id', p_external_id, 'warehouse_id', p_wh);
exception
  when unique_violation then raise exception using errcode = 'WA409', message = 'Armazém já mapeado para outro depósito.';
  when foreign_key_violation then raise exception using errcode = 'WA422', message = 'Armazém inválido.';
end;
$$;

-- Política validada por depósito: 'validated' só depois de testar em ambiente apropriado.
create or replace function wms.set_stock_posting_policy(
  p_connection uuid, p_wh uuid, p_outbound text, p_inbound text, p_validated boolean, p_notes text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections; v_uid uuid;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if not found then raise exception using errcode = 'WA404', message = 'Conexão não encontrada.'; end if;
  v_uid := wms.require(v_c.organization_id, 'integrations.manage');
  insert into wms.stock_posting_policies (organization_id, connection_id, warehouse_id, outbound_policy, inbound_policy,
                                          validated_at, validated_by, notes, updated_at)
  values (v_c.organization_id, p_connection, p_wh, p_outbound, p_inbound,
          case when p_validated then now() end, case when p_validated then v_uid end, coalesce(p_notes, ''), now())
  on conflict (connection_id, warehouse_id) do update set
    outbound_policy = excluded.outbound_policy, inbound_policy = excluded.inbound_policy,
    validated_at = excluded.validated_at, validated_by = excluded.validated_by, notes = excluded.notes, updated_at = now();
  perform wms._audit(v_c.organization_id, p_wh, 'posting_policy_set', 'stock_posting_policy', p_connection::text,
    jsonb_build_object('outbound', p_outbound, 'inbound', p_inbound, 'validated', p_validated, 'notes', p_notes));
  return jsonb_build_object('connection_id', p_connection, 'warehouse_id', p_wh);
exception
  when check_violation then raise exception using errcode = 'WA422', message = 'Política inválida.';
  when foreign_key_violation then raise exception using errcode = 'WA422', message = 'Armazém inválido.';
end;
$$;

create or replace function wms.request_sync_job(p_connection uuid, p_kind text, p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections; v_uid uuid; v_id uuid;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if not found then raise exception using errcode = 'WA404', message = 'Conexão não encontrada.'; end if;
  v_uid := wms.require(v_c.organization_id, 'integrations.manage');
  insert into wms.integration_jobs (organization_id, connection_id, kind, params, requested_by)
  values (v_c.organization_id, p_connection, p_kind, coalesce(p_params, '{}'::jsonb), v_uid)
  on conflict (connection_id, kind) where status in ('pending', 'running') do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from wms.integration_jobs where connection_id = p_connection and kind = p_kind and status in ('pending', 'running');
    return jsonb_build_object('job_id', v_id, 'already_queued', true);
  end if;
  perform wms._audit(v_c.organization_id, null, 'sync_job_requested', 'integration_job', v_id::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('job_id', v_id, 'already_queued', false);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Tipo de sincronização inválido.';
end;
$$;

-- Reprocessamento com proteção contra duplicidade.
--  failed  + retry        → volta para a fila
--  unknown + retry        → exige nota da análise (efeito externo NÃO aplicado) antes de reenviar
--  unknown + mark_applied → registra como enviado (efeito confirmado no ERP), sem reenviar
--  blocked + retry        → reavalia a política; só libera se agora for lançamento pelo WMS
--  qualquer não enviado + cancel → cancela (ex.: política passou a ser lançamento pelo ERP)
create or replace function wms.resolve_outbox_event(p_event uuid, p_action text, p_note text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_e wms.outbox_events; v_uid uuid; v_replay jsonb; v_mode text; v_new text; v_result jsonb;
begin
  select * into v_e from wms.outbox_events where id = p_event;
  if not found then raise exception using errcode = 'WA404', message = 'Evento não encontrado.'; end if;
  v_uid := wms.require(v_e.organization_id, 'integrations.manage');
  v_replay := wms._idem_begin(v_e.organization_id, 'resolve_outbox_event', p_key, jsonb_build_object('e', p_event, 'a', p_action, 'n', p_note));
  if v_replay is not null then return v_replay; end if;
  select * into v_e from wms.outbox_events where id = p_event for update;
  if v_e.status in ('sent', 'cancelled') then
    raise exception using errcode = 'WA409', message = 'Evento já encerrado.', detail = v_e.status;
  end if;
  if v_e.status = 'processing' and v_e.lease_until > now() then
    raise exception using errcode = 'WA409', message = 'Evento em processamento pelo worker.';
  end if;
  if p_action in ('mark_applied', 'cancel') or v_e.status = 'unknown' then
    if coalesce(trim(p_note), '') = '' then
      raise exception using errcode = 'WA422', message = 'Registre a análise operacional na nota.';
    end if;
  end if;
  if p_action = 'retry' then
    if v_e.status = 'blocked' then
      v_mode := case when v_e.warehouse_id is not null and v_e.event_type in ('stock.post_outbound', 'stock.post_inbound')
                     then wms._erp_posting_mode(v_e.warehouse_id, case when v_e.event_type = 'stock.post_outbound' then 'outbound' else 'inbound' end) end;
      if v_mode is distinct from 'outbox' then
        raise exception using errcode = 'WA409', message = 'Política de lançamento ainda não permite envio deste evento.', detail = coalesce(v_mode, 'unsupported');
      end if;
    end if;
    v_new := 'pending';
    update wms.outbox_events set status = 'pending', attempts = 0, next_attempt_at = now(), lease_owner = null, lease_until = null,
           send_started_at = null, needs_verification = false, blocked_reason = null, last_error = null
     where id = p_event;
  elsif p_action = 'mark_applied' then
    if v_e.status not in ('unknown', 'failed') then
      raise exception using errcode = 'WA409', message = 'Só eventos com resultado desconhecido/falha podem ser marcados como aplicados.';
    end if;
    v_new := 'sent';
    update wms.outbox_events set status = 'sent', sent_at = now(), external_ref = coalesce(external_ref, 'manual'), lease_owner = null where id = p_event;
  elsif p_action = 'cancel' then
    v_new := 'cancelled';
    update wms.outbox_events set status = 'cancelled', lease_owner = null where id = p_event;
  else
    raise exception using errcode = 'WA422', message = 'Ação inválida.';
  end if;
  insert into wms.integration_attempts (organization_id, connection_id, outbox_id, operation, outcome, message, finished_at)
  values (v_e.organization_id, v_e.connection_id, p_event, 'operator_' || p_action,
          case when p_action = 'mark_applied' then 'verified_applied' when p_action = 'retry' and v_e.status = 'unknown' then 'verified_not_applied' else 'success' end,
          left(p_note, 500), now());
  perform wms._audit(v_e.organization_id, v_e.warehouse_id, 'outbox_' || p_action, 'outbox_event', p_event::text,
                     jsonb_build_object('from', v_e.status, 'to', v_new, 'note', p_note));
  v_result := jsonb_build_object('event_id', p_event, 'status', v_new);
  return wms._idem_finish(v_e.organization_id, p_key, v_result);
end;
$$;

create or replace function wms.retry_inbox_event(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_e wms.inbox_events;
begin
  select * into v_e from wms.inbox_events where id = p_event for update;
  if not found then raise exception using errcode = 'WA404', message = 'Evento não encontrado.'; end if;
  perform wms.require(v_e.organization_id, 'integrations.manage');
  if v_e.status not in ('failed', 'ignored') then
    raise exception using errcode = 'WA409', message = 'Evento não está com falha.';
  end if;
  update wms.inbox_events set status = 'pending', next_attempt_at = now(), attempts = 0, last_error = null where id = p_event;
  perform wms._audit(v_e.organization_id, null, 'inbox_retry', 'inbox_event', p_event::text, '{}'::jsonb);
  return jsonb_build_object('event_id', p_event, 'status', 'pending');
end;
$$;

create or replace function wms.resolve_discrepancy(p_discrepancy uuid, p_status text, p_resolution text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d wms.discrepancies; v_uid uuid;
begin
  select * into v_d from wms.discrepancies where id = p_discrepancy for update;
  if not found then raise exception using errcode = 'WA404', message = 'Ocorrência não encontrada.'; end if;
  v_uid := wms.require(v_d.organization_id, 'discrepancies.resolve', v_d.warehouse_id);
  if p_status not in ('resolved', 'dismissed') or coalesce(trim(p_resolution), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe a decisão e a justificativa.';
  end if;
  if v_d.status <> 'open' then
    raise exception using errcode = 'WA409', message = 'Ocorrência já encerrada.';
  end if;
  update wms.discrepancies set status = p_status, resolution = p_resolution, resolved_by = v_uid, resolved_at = now() where id = p_discrepancy;
  perform wms._audit(v_d.organization_id, v_d.warehouse_id, 'discrepancy_' || p_status, 'discrepancy', p_discrepancy::text,
                     jsonb_build_object('resolution', p_resolution));
  return jsonb_build_object('discrepancy_id', p_discrepancy, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------
-- Webhook → inbox (HTTP 200 só depois desta inserção durável)
-- ---------------------------------------------------------------------
create or replace function wms.inbox_receive(p_webhook_ref text, p_dedup_key text, p_event_type text, p_entity_external_id text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections; v_id uuid;
begin
  select * into v_c from wms.integration_connections where webhook_ref = p_webhook_ref;
  if not found or v_c.status = 'disabled' then
    raise exception using errcode = 'WA404', message = 'Conexão desconhecida.';
  end if;
  insert into wms.inbox_events (organization_id, connection_id, source, dedup_key, event_type, entity_external_id, payload)
  values (v_c.organization_id, v_c.id, 'webhook', p_dedup_key, coalesce(nullif(p_event_type, ''), 'unknown'), p_entity_external_id, p_payload)
  on conflict (connection_id, dedup_key) do nothing
  returning id into v_id;
  return jsonb_build_object('inbox_id', v_id, 'duplicate', v_id is null);
end;
$$;

-- ---------------------------------------------------------------------
-- Worker: outbox com lease
-- ---------------------------------------------------------------------
create or replace function wms.worker_claim_outbox(p_owner text, p_limit integer, p_lease_seconds integer)
returns setof wms.outbox_events
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with c as (
    select e.id
      from wms.outbox_events e
      join wms.integration_connections ic on ic.id = e.connection_id
     where ic.status = 'active' and ic.write_enabled
       and ((e.status = 'pending' and e.next_attempt_at <= now())
            or (e.status = 'processing' and e.lease_until < now()))
     order by e.created_at
     limit greatest(p_limit, 1)
     for update of e skip locked
  )
  update wms.outbox_events e set
    status = 'processing',
    -- lease expirado depois de iniciar envio: o efeito externo precisa ser verificado antes de repetir
    needs_verification = e.needs_verification or (e.status = 'processing' and e.send_started_at is not null),
    lease_owner = p_owner,
    lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 5)),
    attempts = e.attempts + 1
    from c where e.id = c.id
  returning e.*;
end;
$$;

create or replace function wms._worker_own(p_event uuid, p_owner text)
returns wms.outbox_events
language plpgsql security definer set search_path = ''
as $$
declare v wms.outbox_events;
begin
  select * into v from wms.outbox_events where id = p_event for update;
  if not found or v.lease_owner is distinct from p_owner or v.status <> 'processing' then
    raise exception using errcode = 'WA409', message = 'Lease perdido para este evento.', detail = 'lease_lost';
  end if;
  return v;
end;
$$;

-- Marca o início do envio (commit ANTES da chamada HTTP).
create or replace function wms.worker_mark_sending(p_event uuid, p_owner text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform wms._worker_own(p_event, p_owner);
  update wms.outbox_events set send_started_at = now() where id = p_event;
end;
$$;

create or replace function wms.worker_complete_outbox(
  p_event uuid, p_owner text, p_external_ref text, p_http_status integer, p_response jsonb, p_correlation text, p_outcome text default 'success')
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.outbox_events;
begin
  v := wms._worker_own(p_event, p_owner);
  update wms.outbox_events set status = 'sent', sent_at = now(), external_ref = p_external_ref, lease_owner = null, lease_until = null,
         needs_verification = false, last_error = null
   where id = p_event;
  insert into wms.integration_attempts (organization_id, connection_id, outbox_id, operation, outcome, http_status, response_excerpt, correlation_id, finished_at)
  values (v.organization_id, v.connection_id, p_event, v.event_type, p_outcome, p_http_status, p_response, p_correlation, now());
end;
$$;

-- Falha: transitória (backoff, respeitando Retry-After), permanente (fila de falhas),
-- desconhecida (timeout após escrita → análise antes de reenviar) ou capacidade indisponível.
create or replace function wms.worker_fail_outbox(
  p_event uuid, p_owner text, p_outcome text, p_http_status integer, p_error_code text, p_message text,
  p_retry_after_seconds integer, p_correlation text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v wms.outbox_events; v_status text;
begin
  v := wms._worker_own(p_event, p_owner);
  v_status := case
    when p_outcome = 'transient_error' and v.attempts < v.max_attempts then 'pending'
    when p_outcome = 'transient_error' then 'failed'
    when p_outcome = 'permanent_error' then 'failed'
    when p_outcome = 'unknown' then 'unknown'
    when p_outcome = 'capability_unavailable' then 'blocked'
    else 'failed' end;
  update wms.outbox_events set status = v_status,
         next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 30), 1)),
         lease_owner = null, lease_until = null,
         send_started_at = case when v_status = 'pending' then null else send_started_at end,
         blocked_reason = case when v_status = 'blocked' then coalesce(p_error_code, 'capability_unavailable') else blocked_reason end,
         last_error = left(coalesce(p_error_code || ': ', '') || coalesce(p_message, ''), 1000)
   where id = p_event;
  insert into wms.integration_attempts (organization_id, connection_id, outbox_id, operation, outcome, http_status, error_code, message, correlation_id, finished_at)
  values (v.organization_id, v.connection_id, p_event, v.event_type, p_outcome, p_http_status, p_error_code, left(p_message, 1000), p_correlation, now());
  return v_status;
end;
$$;

-- Resultado da verificação do efeito externo (retomada após crash).
create or replace function wms.worker_verified_outbox(p_event uuid, p_owner text, p_applied boolean, p_external_ref text, p_correlation text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.outbox_events;
begin
  v := wms._worker_own(p_event, p_owner);
  insert into wms.integration_attempts (organization_id, connection_id, outbox_id, operation, outcome, correlation_id, finished_at)
  values (v.organization_id, v.connection_id, p_event, 'verify', case when p_applied then 'verified_applied' else 'verified_not_applied' end, p_correlation, now());
  if p_applied then
    update wms.outbox_events set status = 'sent', sent_at = now(), external_ref = p_external_ref, lease_owner = null, lease_until = null,
           needs_verification = false where id = p_event;
  else
    update wms.outbox_events set needs_verification = false, send_started_at = null where id = p_event;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Worker: inbox e jobs
-- ---------------------------------------------------------------------
create or replace function wms.worker_claim_inbox(p_owner text, p_limit integer, p_lease_seconds integer)
returns setof wms.inbox_events
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with c as (
    select e.id from wms.inbox_events e
      join wms.integration_connections ic on ic.id = e.connection_id
     where ic.status = 'active'
       and ((e.status = 'pending' and e.next_attempt_at <= now()) or (e.status = 'processing' and e.lease_until < now()))
     -- por entidade, na ordem de chegada
     order by e.received_at
     limit greatest(p_limit, 1)
     for update of e skip locked
  )
  update wms.inbox_events e set status = 'processing', lease_owner = p_owner,
         lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 5)), attempts = e.attempts + 1
    from c where e.id = c.id
  returning e.*;
end;
$$;

create or replace function wms.worker_finish_inbox(p_event uuid, p_owner text, p_status text, p_error text, p_retry_seconds integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.inbox_events;
begin
  select * into v from wms.inbox_events where id = p_event for update;
  if v.lease_owner is distinct from p_owner then
    raise exception using errcode = 'WA409', message = 'Lease perdido.', detail = 'lease_lost';
  end if;
  update wms.inbox_events set
    status = case when p_status = 'retry' and v.attempts < 10 then 'pending' when p_status = 'retry' then 'failed' else p_status end,
    next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 60), 1)),
    lease_owner = null, lease_until = null, last_error = left(p_error, 1000),
    processed_at = case when p_status in ('processed', 'ignored') then now() end
   where id = p_event;
end;
$$;

create or replace function wms.worker_enqueue_poll_event(p_connection uuid, p_dedup_key text, p_event_type text, p_entity_external_id text, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections; v uuid;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  insert into wms.inbox_events (organization_id, connection_id, source, dedup_key, event_type, entity_external_id, payload)
  values (v_c.organization_id, p_connection, 'poll', p_dedup_key, p_event_type, p_entity_external_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (connection_id, dedup_key) do nothing returning id into v;
  return v;
end;
$$;

create or replace function wms.worker_claim_job(p_owner text, p_lease_seconds integer)
returns setof wms.integration_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with c as (
    select j.id from wms.integration_jobs j join wms.integration_connections ic on ic.id = j.connection_id
     where ic.status = 'active'
       and ((j.status = 'pending' and j.next_attempt_at <= now()) or (j.status = 'running' and j.lease_until < now()))
     order by j.created_at limit 1 for update of j skip locked
  )
  update wms.integration_jobs j set status = 'running', lease_owner = p_owner,
         lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 5)), attempts = j.attempts + 1
    from c where j.id = c.id
  returning j.*;
end;
$$;

create or replace function wms.worker_update_job(p_job uuid, p_owner text, p_status text, p_progress jsonb, p_error text, p_retry_seconds integer, p_lease_seconds integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.integration_jobs;
begin
  select * into v from wms.integration_jobs where id = p_job for update;
  if v.lease_owner is distinct from p_owner then
    raise exception using errcode = 'WA409', message = 'Lease perdido.', detail = 'lease_lost';
  end if;
  update wms.integration_jobs set
    status = case when p_status = 'retry' and v.attempts < 8 then 'pending' when p_status = 'retry' then 'failed' else p_status end,
    progress = coalesce(p_progress, progress),
    last_error = left(p_error, 1000),
    next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 60), 1)),
    lease_until = case when p_status = 'running' then now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 5)) end,
    lease_owner = case when p_status = 'running' then p_owner end,
    finished_at = case when p_status in ('completed', 'failed', 'cancelled') then now() end
   where id = p_job;
end;
$$;

create or replace function wms.worker_set_cursor(p_connection uuid, p_resource text, p_cursor jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into wms.sync_cursors (connection_id, resource, cursor, updated_at) values (p_connection, p_resource, p_cursor, now())
  on conflict (connection_id, resource) do update set cursor = excluded.cursor, updated_at = now();
$$;

-- ---------------------------------------------------------------------
-- Worker: limite de requisições por conta (compartilhado entre processos)
-- Devolve quantos ms esperar (0 = pode chamar agora).
-- ---------------------------------------------------------------------
create or replace function wms.worker_take_rate_token(p_connection uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v wms.rate_limit_windows;
begin
  insert into wms.rate_limit_windows (connection_id, bucket, window_start, used, limit_per_window)
  values (p_connection, p_bucket, now(), 0, p_limit) on conflict do nothing;
  select * into v from wms.rate_limit_windows where connection_id = p_connection and bucket = p_bucket for update;
  if v.blocked_until is not null and v.blocked_until > now() then
    return ceil(extract(epoch from (v.blocked_until - now())) * 1000)::integer;
  end if;
  if v.window_start + make_interval(secs => p_window_seconds) <= now() then
    update wms.rate_limit_windows set window_start = now(), used = 1, limit_per_window = p_limit, blocked_until = null
     where connection_id = p_connection and bucket = p_bucket;
    return 0;
  end if;
  if v.used < least(v.limit_per_window, p_limit) then
    update wms.rate_limit_windows set used = used + 1 where connection_id = p_connection and bucket = p_bucket;
    return 0;
  end if;
  return ceil(extract(epoch from (v.window_start + make_interval(secs => p_window_seconds) - now())) * 1000)::integer;
end;
$$;

-- Ajusta pela resposta real (X-RateLimit-Remaining / X-RateLimit-Reset / 429).
create or replace function wms.worker_rate_feedback(p_connection uuid, p_bucket text, p_remaining integer, p_reset_seconds integer, p_limit integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into wms.rate_limit_windows (connection_id, bucket, window_start, used, limit_per_window)
  values (p_connection, p_bucket, now(), 0, coalesce(p_limit, 1)) on conflict do nothing;
  update wms.rate_limit_windows set
    limit_per_window = coalesce(p_limit, limit_per_window),
    blocked_until = case when p_remaining is not null and p_remaining <= 0 then now() + make_interval(secs => greatest(coalesce(p_reset_seconds, 60), 1))
                         else blocked_until end
   where connection_id = p_connection and bucket = p_bucket;
end;
$$;

-- ---------------------------------------------------------------------
-- Worker: credenciais (refresh serializado por conexão com lease)
-- ---------------------------------------------------------------------
create or replace function wms.worker_get_connection(p_connection uuid)
returns wms.integration_connections
language sql stable security definer set search_path = ''
as $$
  select * from wms.integration_connections where id = p_connection;
$$;

create or replace function wms.worker_claim_token_refresh(p_connection uuid, p_owner text, p_lease_seconds integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_rows integer;
begin
  update wms.integration_connections
     set refresh_lease_owner = p_owner, refresh_lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 5))
   where id = p_connection and status = 'active'
     and (refresh_lease_until is null or refresh_lease_until < now() or refresh_lease_owner = p_owner);
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function wms.worker_store_credentials(
  p_connection uuid, p_owner text, p_ciphertext text, p_key_version integer, p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz, p_expected_version integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v wms.integration_connections;
begin
  select * into v from wms.integration_connections where id = p_connection for update;
  if v.refresh_lease_owner is distinct from p_owner or v.refresh_lease_until < now() then
    raise exception using errcode = 'WA409', message = 'Lease de renovação perdido.', detail = 'lease_lost';
  end if;
  if v.credentials_version <> p_expected_version then
    raise exception using errcode = 'WA409', message = 'Credenciais já renovadas por outro processo.', detail = 'version_conflict';
  end if;
  update wms.integration_connections set credentials_ciphertext = p_ciphertext, credentials_key_version = p_key_version,
         credentials_version = credentials_version + 1, access_token_expires_at = p_access_expires_at,
         refresh_token_expires_at = p_refresh_expires_at, refresh_lease_owner = null, refresh_lease_until = null, updated_at = now()
   where id = p_connection;
  return v.credentials_version + 1;
end;
$$;

create or replace function wms.worker_release_refresh_lease(p_connection uuid, p_owner text)
returns void
language sql security definer set search_path = ''
as $$
  update wms.integration_connections set refresh_lease_owner = null, refresh_lease_until = null
   where id = p_connection and refresh_lease_owner = p_owner;
$$;

-- Expiração/revogação: pausa segura dos jobs dependentes e alerta visível.
create or replace function wms.worker_mark_reauthorization(p_connection uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.integration_connections;
begin
  select * into v from wms.integration_connections where id = p_connection for update;
  update wms.integration_connections set status = 'reauthorization_required', status_reason = left(p_reason, 300),
         refresh_lease_owner = null, refresh_lease_until = null, updated_at = now()
   where id = p_connection;
  insert into wms.audit_events (organization_id, action, entity_type, entity_id, data)
  values (v.organization_id, 'connection_reauthorization_required', 'integration_connection', p_connection::text, jsonb_build_object('reason', p_reason));
end;
$$;

-- Callback OAuth: consome o state (uso único, com validade) e devolve o PKCE cifrado.
create or replace function wms.worker_consume_oauth_state(p_connection uuid, p_state_hash text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v wms.integration_connections;
begin
  select * into v from wms.integration_connections where id = p_connection for update;
  if not found or v.oauth_state_hash is null or v.oauth_state_hash <> p_state_hash or v.oauth_state_expires_at < now() then
    raise exception using errcode = 'WA403', message = 'Autorização inválida ou expirada.', detail = 'invalid_state';
  end if;
  update wms.integration_connections set oauth_state_hash = null, oauth_state_expires_at = null, oauth_pkce_ciphertext = null where id = p_connection;
  return coalesce(v.oauth_pkce_ciphertext, '');
end;
$$;

create or replace function wms.worker_save_authorized_credentials(
  p_connection uuid, p_ciphertext text, p_key_version integer, p_access_expires_at timestamptz, p_refresh_expires_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.integration_connections;
begin
  select * into v from wms.integration_connections where id = p_connection for update;
  update wms.integration_connections set credentials_ciphertext = p_ciphertext, credentials_key_version = p_key_version,
         credentials_version = credentials_version + 1, access_token_expires_at = p_access_expires_at,
         refresh_token_expires_at = p_refresh_expires_at, status = 'active', status_reason = null, updated_at = now()
   where id = p_connection;
  insert into wms.audit_events (organization_id, actor_id, action, entity_type, entity_id, data)
  values (v.organization_id, v.oauth_started_by, 'connection_authorized', 'integration_connection', p_connection::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Worker: aplicação de dados do ERP (sempre com dado consultado pela API autenticada)
-- ---------------------------------------------------------------------
-- Compara versões externas (data/hora ou número); nulo = desconhecida.
create or replace function wms._version_cmp(a text, b text)
returns integer
language plpgsql immutable set search_path = ''
as $$
begin
  if a is null or b is null then return 0; end if;
  begin
    return sign(extract(epoch from (a::timestamptz - b::timestamptz)))::integer;
  exception when others then null;
  end;
  begin
    return sign(a::numeric - b::numeric)::integer;
  exception when others then null;
  end;
  return case when a < b then -1 when a > b then 1 else 0 end;
end;
$$;

create or replace function wms.worker_upsert_deposit(p_connection uuid, p_external_id text, p_name text, p_raw jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.integration_connections;
begin
  select * into v from wms.integration_connections where id = p_connection;
  insert into wms.erp_deposits (organization_id, connection_id, external_id, name, raw)
  values (v.organization_id, p_connection, p_external_id, coalesce(p_name, ''), coalesce(p_raw, '{}'::jsonb))
  on conflict (connection_id, external_id) do update set name = excluded.name, raw = excluded.raw, updated_at = now();
end;
$$;

-- Produto pelo ID externo. Controles de lote/série/validade são configuração do WMS (preservados).
create or replace function wms.worker_upsert_product(p_connection uuid, p_snapshot jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c wms.integration_connections; v_map wms.external_mappings; v_id uuid; v_hash text;
  v_ext text := p_snapshot ->> 'external_id';
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if v_ext is null or coalesce(p_snapshot ->> 'sku', '') = '' then
    raise exception using errcode = 'WA422', message = 'Produto do ERP sem ID externo ou SKU.';
  end if;
  v_hash := wms._payload_hash('product', p_snapshot);
  select * into v_map from wms.external_mappings where connection_id = p_connection and entity_type = 'product' and external_id = v_ext;
  if found then
    if wms._version_cmp(p_snapshot ->> 'external_version', v_map.external_version) < 0 then
      return jsonb_build_object('status', 'stale', 'product_id', v_map.internal_id);
    end if;
    if v_map.payload_hash = v_hash then
      return jsonb_build_object('status', 'unchanged', 'product_id', v_map.internal_id);
    end if;
    update wms.products set sku = p_snapshot ->> 'sku', description = left(coalesce(p_snapshot ->> 'description', p_snapshot ->> 'sku'), 200),
           gtin = case when p_snapshot ->> 'gtin' ~ '^[0-9]{8,14}$' then p_snapshot ->> 'gtin' end,
           status = case when p_snapshot ->> 'status' = 'inactive' then 'inactive' else 'active' end, updated_at = now()
     where id = v_map.internal_id;
    update wms.external_mappings set external_version = p_snapshot ->> 'external_version', payload_hash = v_hash, updated_at = now()
     where connection_id = p_connection and entity_type = 'product' and external_id = v_ext;
    return jsonb_build_object('status', 'updated', 'product_id', v_map.internal_id);
  end if;
  if exists (select 1 from wms.products where organization_id = v_c.organization_id and sku = p_snapshot ->> 'sku') then
    perform wms._discrepancy(v_c.organization_id, null, 'product_sku_conflict', 'product', null, null, null, null,
                             jsonb_build_object('external_id', v_ext, 'sku', p_snapshot ->> 'sku'));
    return jsonb_build_object('status', 'conflict');
  end if;
  insert into wms.products (organization_id, sku, description, gtin, base_unit, status)
  values (v_c.organization_id, p_snapshot ->> 'sku', left(coalesce(p_snapshot ->> 'description', p_snapshot ->> 'sku'), 200),
          case when p_snapshot ->> 'gtin' ~ '^[0-9]{8,14}$' then p_snapshot ->> 'gtin' end,
          coalesce(nullif(upper(regexp_replace(coalesce(p_snapshot ->> 'unit', ''), '[^A-Za-z0-9]', '', 'g')), ''), 'UN'),
          case when p_snapshot ->> 'status' = 'inactive' then 'inactive' else 'active' end)
  returning id into v_id;
  insert into wms.external_mappings (organization_id, connection_id, entity_type, external_id, internal_id, external_version, payload_hash)
  values (v_c.organization_id, p_connection, 'product', v_ext, v_id, p_snapshot ->> 'external_version', v_hash);
  return jsonb_build_object('status', 'created', 'product_id', v_id);
end;
$$;

-- Pedido do ERP: elegibilidade, revisão, cancelamento e proteção contra fora de ordem.
create or replace function wms.worker_apply_order_snapshot(p_connection uuid, p_snapshot jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c wms.integration_connections; v_wh uuid; v_map wms.external_mappings; v_o wms.orders;
  v_ext text := p_snapshot ->> 'external_id'; v_items jsonb := '[]'::jsonb; it record; v_pid uuid; v_hash text;
  v_cancelled boolean; v_eligible boolean; v_id uuid; v_rev integer;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  if v_ext is null then
    raise exception using errcode = 'WA422', message = 'Pedido sem ID externo.';
  end if;
  v_cancelled := (p_snapshot ->> 'erp_status') in (select jsonb_array_elements_text(coalesce(v_c.settings -> 'cancelled_order_statuses', '[]'::jsonb)));
  v_eligible := (p_snapshot ->> 'erp_status') = any (v_c.eligible_order_statuses);
  select * into v_map from wms.external_mappings where connection_id = p_connection and entity_type = 'order' and external_id = v_ext;

  if v_map.internal_id is null and not v_eligible then
    return jsonb_build_object('status', 'ignored', 'reason', 'not_eligible');
  end if;
  if v_map.internal_id is not null and wms._version_cmp(p_snapshot ->> 'external_version', v_map.external_version) < 0 then
    return jsonb_build_object('status', 'stale', 'order_id', v_map.internal_id);
  end if;

  select d.warehouse_id into v_wh from wms.erp_deposits d where d.connection_id = p_connection and d.external_id = p_snapshot ->> 'deposit_external_id';
  if v_wh is null and v_map.internal_id is null then
    raise exception using errcode = 'WA422', message = 'Depósito do pedido não mapeado para um armazém.', detail = 'deposit_not_mapped';
  end if;

  for it in select x ->> 'product_external_id' as pext, (x ->> 'quantity')::numeric as qty, x ->> 'external_item_id' as iext
              from jsonb_array_elements(coalesce(p_snapshot -> 'items', '[]'::jsonb)) x loop
    select internal_id into v_pid from wms.external_mappings where connection_id = p_connection and entity_type = 'product' and external_id = it.pext;
    if v_pid is null then
      raise exception using errcode = 'WA422', message = format('Produto %s do pedido não sincronizado.', it.pext), detail = 'product_not_mapped';
    end if;
    v_items := v_items || jsonb_build_object('product_id', v_pid, 'quantity', it.qty, 'external_item_id', it.iext);
  end loop;
  v_hash := wms._items_hash(v_items);

  if v_map.internal_id is null then
    if v_cancelled then
      return jsonb_build_object('status', 'ignored', 'reason', 'cancelled_before_import');
    end if;
    insert into wms.orders (organization_id, warehouse_id, connection_id, external_id, number, customer_name, erp_status, fiscal_status,
                            external_version, items_hash, ship_by)
    values (v_c.organization_id, v_wh, p_connection, v_ext, coalesce(p_snapshot ->> 'number', v_ext), left(coalesce(p_snapshot ->> 'customer_name', ''), 200),
            p_snapshot ->> 'erp_status', coalesce(p_snapshot ->> 'fiscal_status', 'pending'), p_snapshot ->> 'external_version', v_hash,
            (p_snapshot ->> 'ship_by')::timestamptz)
    returning id into v_id;
    perform wms._insert_order_items(v_c.organization_id, v_id, v_items);
    insert into wms.order_revisions (order_id, revision, items_hash, external_version, payload)
    values (v_id, 1, v_hash, p_snapshot ->> 'external_version', jsonb_build_object('items', v_items, 'snapshot', p_snapshot));
    insert into wms.external_mappings (organization_id, connection_id, entity_type, external_id, internal_id, external_version, payload_hash)
    values (v_c.organization_id, p_connection, 'order', v_ext, v_id, p_snapshot ->> 'external_version', v_hash);
    insert into wms.audit_events (organization_id, warehouse_id, action, entity_type, entity_id, data)
    values (v_c.organization_id, v_wh, 'order_imported', 'order', v_id::text, jsonb_build_object('external_id', v_ext));
    return jsonb_build_object('status', 'created', 'order_id', v_id);
  end if;

  select * into v_o from wms.orders where id = v_map.internal_id for update;
  update wms.orders set erp_status = p_snapshot ->> 'erp_status',
         fiscal_status = coalesce(p_snapshot ->> 'fiscal_status', fiscal_status),
         customer_name = left(coalesce(p_snapshot ->> 'customer_name', customer_name), 200),
         external_version = coalesce(p_snapshot ->> 'external_version', external_version), updated_at = now()
   where id = v_o.id;
  update wms.external_mappings set external_version = coalesce(p_snapshot ->> 'external_version', external_version), payload_hash = v_hash, updated_at = now()
   where connection_id = p_connection and entity_type = 'order' and external_id = v_ext;

  if v_cancelled then
    if v_o.status in ('dispatched', 'partially_dispatched') then
      perform wms._discrepancy(v_o.organization_id, v_o.warehouse_id, 'cancelled_after_dispatch', 'order', v_o.id, null, null, null,
                               jsonb_build_object('external_id', v_ext));
      return jsonb_build_object('status', 'discrepancy', 'order_id', v_o.id);
    end if;
    perform wms._cancel_order_internal(v_o.id, 'Cancelado no ERP');
    return jsonb_build_object('status', 'cancelled', 'order_id', v_o.id);
  end if;

  if v_o.items_hash is distinct from v_hash then
    select coalesce(max(revision), 0) + 1 into v_rev from wms.order_revisions where order_id = v_o.id;
    insert into wms.order_revisions (order_id, revision, items_hash, external_version, payload)
    values (v_o.id, v_rev, v_hash, p_snapshot ->> 'external_version', jsonb_build_object('items', v_items, 'snapshot', p_snapshot));
    update wms.orders set revision = v_rev where id = v_o.id;
    if v_o.status = 'awaiting_allocation' then
      update wms.order_items set superseded = true where order_id = v_o.id and not superseded;
      perform wms._insert_order_items(v_o.organization_id, v_o.id, v_items);
      update wms.orders set items_hash = v_hash, allocated_revision = null where id = v_o.id;
      return jsonb_build_object('status', 'updated', 'order_id', v_o.id, 'revision', v_rev);
    elsif v_o.status in ('dispatched', 'partially_dispatched', 'cancelled') then
      perform wms._discrepancy(v_o.organization_id, v_o.warehouse_id, 'order_changed_after_close', 'order', v_o.id, null, null, null,
                               jsonb_build_object('revision', v_rev, 'status', v_o.status));
      return jsonb_build_object('status', 'discrepancy', 'order_id', v_o.id, 'revision', v_rev);
    else
      perform wms._hold_order_for_revision(v_o.id, v_rev);
      return jsonb_build_object('status', 'held', 'order_id', v_o.id, 'revision', v_rev);
    end if;
  end if;
  return jsonb_build_object('status', 'unchanged', 'order_id', v_o.id);
end;
$$;

-- Previsão de recebimento a partir de ordem de compra do ERP (não cria estoque).
create or replace function wms.worker_upsert_purchase_receipt(p_connection uuid, p_snapshot jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c wms.integration_connections; v_wh uuid; v_r wms.receipts; v_id uuid; it record; v_pid uuid; v_line integer := 0;
  v_ext text := p_snapshot ->> 'external_id';
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  select d.warehouse_id into v_wh from wms.erp_deposits d where d.connection_id = p_connection and d.external_id = p_snapshot ->> 'deposit_external_id';
  if v_wh is null then
    raise exception using errcode = 'WA422', message = 'Depósito da ordem de compra não mapeado.', detail = 'deposit_not_mapped';
  end if;
  select * into v_r from wms.receipts where organization_id = v_c.organization_id and source_type = 'erp_purchase_order' and source_ref = v_ext;
  if found then
    return jsonb_build_object('status', 'exists', 'receipt_id', v_r.id);
  end if;
  insert into wms.receipts (organization_id, warehouse_id, source_type, source_ref, connection_id, supplier_name)
  values (v_c.organization_id, v_wh, 'erp_purchase_order', v_ext, p_connection, left(coalesce(p_snapshot ->> 'supplier_name', ''), 200))
  returning id into v_id;
  for it in select x ->> 'product_external_id' as pext, (x ->> 'quantity')::numeric as qty
              from jsonb_array_elements(coalesce(p_snapshot -> 'items', '[]'::jsonb)) x loop
    select internal_id into v_pid from wms.external_mappings where connection_id = p_connection and entity_type = 'product' and external_id = it.pext;
    if v_pid is null then
      raise exception using errcode = 'WA422', message = format('Produto %s não sincronizado.', it.pext), detail = 'product_not_mapped';
    end if;
    v_line := v_line + 1;
    insert into wms.receipt_items (organization_id, receipt_id, line_no, product_id, expected_qty)
    values (v_c.organization_id, v_id, v_line, v_pid, it.qty);
  end loop;
  insert into wms.external_mappings (organization_id, connection_id, entity_type, external_id, internal_id)
  values (v_c.organization_id, p_connection, 'purchase_order', v_ext, v_id) on conflict do nothing;
  return jsonb_build_object('status', 'created', 'receipt_id', v_id);
end;
$$;

-- Conciliação: compara o saldo do ERP com o físico do WMS, considerando lançamentos
-- ainda não confirmados. Diferença real vira ocorrência (nunca sobrescreve o ledger).
create or replace function wms.worker_record_erp_stock(p_connection uuid, p_product_external_id text, p_deposit_external_id text, p_erp_balance numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c wms.integration_connections; v_pid uuid; v_wh uuid; v_wms numeric; v_pending numeric; v_diff numeric; v_disc uuid;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  select internal_id into v_pid from wms.external_mappings where connection_id = p_connection and entity_type = 'product' and external_id = p_product_external_id;
  select warehouse_id into v_wh from wms.erp_deposits where connection_id = p_connection and external_id = p_deposit_external_id;
  if v_pid is null or v_wh is null then
    return jsonb_build_object('status', 'unmapped');
  end if;
  select coalesce(sum(quantity), 0) into v_wms from wms.stock_balances where warehouse_id = v_wh and product_id = v_pid;
  -- Lançamentos ainda não confirmados no ERP: o WMS já moveu, o ERP ainda não
  select coalesce(sum(case when e.event_type = 'stock.post_outbound' then -(l ->> 'quantity')::numeric else (l ->> 'quantity')::numeric end), 0)
    into v_pending
    from wms.outbox_events e, jsonb_array_elements(e.payload -> 'lines') l
   where e.connection_id = p_connection and e.warehouse_id = v_wh and e.status in ('pending', 'processing', 'unknown', 'blocked', 'failed')
     and e.event_type in ('stock.post_outbound', 'stock.post_inbound') and (l ->> 'product_id')::uuid = v_pid;
  v_diff := p_erp_balance - (v_wms - v_pending);
  if v_diff <> 0 then
    select id into v_disc from wms.discrepancies where kind = 'erp_stock_mismatch' and status = 'open' and warehouse_id = v_wh and product_id = v_pid;
    if v_disc is null then
      v_disc := wms._discrepancy(v_c.organization_id, v_wh, 'erp_stock_mismatch', 'product', v_pid, v_pid, null, v_diff,
        jsonb_build_object('erp', p_erp_balance, 'wms', v_wms, 'pending_posts', v_pending));
    else
      update wms.discrepancies set quantity = v_diff, details = jsonb_build_object('erp', p_erp_balance, 'wms', v_wms, 'pending_posts', v_pending, 'checked_at', now())
       where id = v_disc;
    end if;
    return jsonb_build_object('status', 'mismatch', 'difference', v_diff, 'discrepancy_id', v_disc);
  end if;
  return jsonb_build_object('status', 'match');
end;
$$;

-- Contexto de um evento de estoque para o adaptador: IDs externos dos produtos e do depósito.
create or replace function wms.worker_outbox_context(p_event uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'event', to_jsonb(e) - 'payload',
    'payload', e.payload,
    'products', coalesce((select jsonb_object_agg(m.internal_id::text, m.external_id)
                            from wms.external_mappings m
                           where m.connection_id = e.connection_id and m.entity_type = 'product'
                             and m.internal_id::text in (select l ->> 'product_id' from jsonb_array_elements(coalesce(e.payload -> 'lines', '[]'::jsonb)) l)), '{}'::jsonb),
    'order_external_id', (select m.external_id from wms.external_mappings m
                           where m.connection_id = e.connection_id and m.entity_type = 'order' and m.internal_id = e.aggregate_id),
    -- linhas já confirmadas no ERP (não são reenviadas numa retomada)
    'posted_lines', coalesce((select jsonb_object_agg(substr(a.operation, 6), a.response_excerpt ->> 'external_ref')
                                from wms.integration_attempts a
                               where a.outbox_id = e.id and a.operation like 'line:%' and a.outcome in ('success', 'verified_applied')), '{}'::jsonb))
    from wms.outbox_events e where e.id = p_event;
$$;

-- Registra o resultado de UMA linha do evento (sucesso ou aplicado após verificação).
create or replace function wms.worker_record_outbox_line(p_event uuid, p_owner text, p_line text, p_external_ref text, p_outcome text, p_correlation text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v wms.outbox_events;
begin
  v := wms._worker_own(p_event, p_owner);
  insert into wms.integration_attempts (organization_id, connection_id, outbox_id, operation, outcome, response_excerpt, correlation_id, finished_at)
  values (v.organization_id, v.connection_id, p_event, 'line:' || p_line, p_outcome, jsonb_build_object('external_ref', p_external_ref), p_correlation, now());
end;
$$;

-- Leitura do worker (RLS: papel técnico vê as filas e mapeamentos)
do $$
declare t text;
begin
  foreach t in array array['integration_connections', 'outbox_events', 'inbox_events', 'integration_jobs', 'external_mappings',
                            'erp_deposits', 'stock_posting_policies', 'sync_cursors', 'products', 'warehouses'] loop
    execute format('drop policy if exists worker_read on wms.%I', t);
    execute format('create policy worker_read on wms.%I for select to wms_worker using (true)', t);
    execute format('grant select on wms.%I to wms_worker', t);
  end loop;
end $$;

-- O próprio worker agenda sincronizações (ex.: produto ainda não importado, webhook sem ID).
create or replace function wms.worker_request_job(p_connection uuid, p_kind text, p_params jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.integration_connections; v uuid;
begin
  select * into v_c from wms.integration_connections where id = p_connection;
  insert into wms.integration_jobs (organization_id, connection_id, kind, params)
  values (v_c.organization_id, p_connection, p_kind, coalesce(p_params, '{}'::jsonb))
  on conflict (connection_id, kind) where status in ('pending', 'running') do nothing
  returning id into v;
  return v;
end;
$$;
