-- Mantém o site acordado no horário de funcionamento.
--
-- O plano gratuito do Render "dorme" depois de 15 min sem visitas e o primeiro
-- cliente espera ~30 s. Ficar acordado 24 h gastaria quase todas as 750 h
-- gratuitas do mês (que são da conta inteira, divididas entre os serviços).
-- Então o próprio Supabase chama o site a cada 10 min só de 30 min antes de
-- abrir até 15 min depois de fechar, lendo os horários do painel (configuracoes.horarios,
-- dias 0 = domingo … 6 = sábado, horário de São Paulo). Loja "fechada" no painel: não chama.
--
-- Agendamento (feito à parte, pois a URL é de cada instalação):
--   select cron.schedule('manter-servidor-acordado', '*/10 * * * *',
--     $$select privado.manter_servidor_acordado('https://SEU-SITE.onrender.com/api/saude')$$);

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

/** true quando agora (São Paulo) está dentro de um horário, com as margens. */
create or replace function privado.loja_no_horario(
  p_antes interval default interval '30 minutes',
  p_depois interval default interval '15 minutes',
  p_agora timestamptz default now()
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_horarios jsonb;
  v_status text;
  v_agora timestamp := p_agora at time zone 'America/Sao_Paulo';
  v_dia timestamp;
  v_periodo jsonb;
  v_abre timestamp;
  v_fecha timestamp;
  d integer;
begin
  select horarios, status_manual into v_horarios, v_status from public.configuracoes where id = 1;
  if v_status = 'fechada' or v_horarios is null then return false; end if;
  -- Hoje e ontem: um horário de ontem pode passar da meia-noite (ex.: 18:00–02:00)
  for d in 0..1 loop
    v_dia := date_trunc('day', v_agora) - make_interval(days => d);
    for v_periodo in
      select * from jsonb_array_elements(coalesce(v_horarios -> (extract(dow from v_dia)::integer)::text, '[]'::jsonb))
    loop
      continue when coalesce(v_periodo->>'abre', '') = '' or coalesce(v_periodo->>'fecha', '') = '';
      v_abre := v_dia + (v_periodo->>'abre')::time;
      v_fecha := v_dia + (v_periodo->>'fecha')::time;
      if v_fecha <= v_abre then v_fecha := v_fecha + interval '1 day'; end if; -- "00:00" = meia-noite
      if v_agora >= v_abre - p_antes and v_agora < v_fecha + p_depois then return true; end if;
    end loop;
  end loop;
  return false;
end;
$$;

create or replace function privado.manter_servidor_acordado(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if privado.loja_no_horario() then
    -- Assíncrono: não espera o site acordar (pode levar ~30 s)
    perform net.http_get(url := p_url, timeout_milliseconds := 60000);
  end if;
end;
$$;

revoke all on function privado.loja_no_horario(interval, interval, timestamptz) from public, anon, authenticated;
revoke all on function privado.manter_servidor_acordado(text) from public, anon, authenticated;
