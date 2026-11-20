-- Financeiro: conta padrão do caixa.
--
-- Além da conta padrão para vendas, uma conta pode ser a "padrão do caixa": as
-- vendas pagas em DINHEIRO (o dinheiro que fica na gaveta, no PDV ou na entrega)
-- entram nela. Pix e cartão continuam na conta padrão para vendas. Sem conta do
-- caixa marcada, tudo continua indo para a padrão.

alter table public.financeiro_contas add column if not exists padrao_caixa boolean not null default false;
create unique index if not exists financeiro_contas_um_padrao_caixa on public.financeiro_contas (padrao_caixa) where padrao_caixa;

create or replace view public.financeiro_saldos with (security_invoker = true) as
 select c.id, c.nome, c.tipo, c.padrao, c.ativa, c.criado_em,
        coalesce(s.saldo, 0::bigint) as saldo,
        c.padrao_caixa
   from public.financeiro_contas c
   left join (
     select m.conta_id, sum(m.valor)::bigint as saldo
       from (select l.destino_id as conta_id, l.valor from public.financeiro_lancamentos l where l.destino_id is not null
             union all
             select l.origem_id, -l.valor from public.financeiro_lancamentos l where l.origem_id is not null) m
      group by m.conta_id
   ) s on s.conta_id = c.id;

/** Cria ou edita uma conta. p_padrao_caixa null mantém como está (telas antigas). */
drop function if exists public.financeiro_salvar_conta(uuid, text, text, boolean, boolean, bigint);
create function public.financeiro_salvar_conta(
  p_id uuid, p_nome text, p_tipo text, p_padrao boolean, p_ativa boolean,
  p_saldo_inicial bigint default 0, p_padrao_caixa boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare atual public.financeiro_contas%rowtype; caixa boolean;
begin
  perform privado.exigir_admin();perform pg_advisory_xact_lock(11011012);
  if p_id is null or p_nome is null or char_length(btrim(p_nome)) not between 1 and 80 or p_tipo is null or p_tipo not in ('caixa','banco','carteira','outro') or p_padrao is null or p_ativa is null or p_saldo_inicial is null or p_saldo_inicial not between 0 and 1000000000000 then raise exception 'Confira o nome, tipo e saldo da conta.';end if;
  select * into atual from public.financeiro_contas where id=p_id;
  caixa:=coalesce(p_padrao_caixa, atual.padrao_caixa, false);
  if exists(select 1 from public.financeiro_contas c where lower(btrim(c.nome))=lower(btrim(p_nome)) and c.id<>p_id) then raise exception 'Já existe uma conta com esse nome.';end if;
  if p_padrao and not p_ativa then raise exception 'A conta padrão precisa estar ativa.';end if;
  if caixa and not p_ativa then raise exception 'A conta padrão do caixa precisa estar ativa.';end if;
  if atual.padrao and not p_padrao then raise exception 'Escolha outra conta como padrão antes de retirar esta.';end if;
  if p_padrao then update public.financeiro_contas set padrao=false where padrao and id<>p_id;end if;
  if caixa then update public.financeiro_contas set padrao_caixa=false where padrao_caixa and id<>p_id;end if;
  if atual.id is not null then
    if not p_ativa and exists(select 1 from public.financeiro_saldos where id=p_id and saldo<>0) then raise exception 'Transfira ou confira o saldo antes de desativar a conta.';end if;
    update public.financeiro_contas set nome=btrim(p_nome),tipo=p_tipo,padrao=p_padrao,ativa=p_ativa,padrao_caixa=caixa where id=p_id;
  else
    if not p_ativa and p_saldo_inicial>0 then raise exception 'Uma conta com saldo inicial precisa estar ativa.';end if;
    insert into public.financeiro_contas(id,nome,tipo,padrao,ativa,padrao_caixa) values(p_id,btrim(p_nome),p_tipo,p_padrao,p_ativa,caixa);
    if p_saldo_inicial>0 then insert into public.financeiro_lancamentos(id,tipo,destino_id,valor,descricao,categoria) values(p_id,'abertura',p_id,p_saldo_inicial,'Saldo inicial','Saldo inicial');end if;
  end if;
  return p_id;
end;$function$;
revoke all on function public.financeiro_salvar_conta(uuid, text, text, boolean, boolean, bigint, boolean) from public, anon;
grant execute on function public.financeiro_salvar_conta(uuid, text, text, boolean, boolean, bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Venda concluída: em dinheiro vai para a conta do caixa (se houver)
-- ---------------------------------------------------------------------
create or replace function privado.financeiro_por_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare venda public.financeiro_vendas%rowtype; conta uuid; lancamento uuid; pedido uuid; numero bigint; liquido integer; detalhe text;
begin
  if TG_OP='UPDATE' and new.status is not distinct from old.status and new.total is not distinct from old.total
     and new.tarifa is not distinct from old.tarifa then return new;end if;
  if TG_OP<>'DELETE' and new.status<>'concluido' and not exists(select 1 from public.financeiro_vendas where pedido_id=new.id) then return new;end if;
  pedido:=case when TG_OP='DELETE' then old.id else new.id end;
  numero:=case when TG_OP='DELETE' then old.numero else new.numero end;
  liquido:=case when TG_OP='DELETE' then 0 else new.total-coalesce(new.tarifa,0) end;
  perform pg_advisory_xact_lock(11011012);
  select * into venda from public.financeiro_vendas where pedido_id=pedido;
  if TG_OP='UPDATE' and old.status='concluido' and new.status='concluido' and venda.pedido_id is null
    and old.criado_em<(select iniciado_em from public.financeiro_config where id=1) then return new;end if;
  if TG_OP<>'DELETE' and new.status='concluido' and venda.pedido_id is not null and venda.valor=liquido then return new;end if;
  if venda.pedido_id is not null then
    insert into public.financeiro_lancamentos(tipo,origem_id,valor,descricao,categoria,pedido_id,pedido_numero,estorno_de)
      values('estorno_venda',venda.conta_id,venda.valor,'Estorno da venda #'||numero,'Vendas',pedido,numero,venda.lancamento_id);
    delete from public.financeiro_vendas where pedido_id=pedido;
  end if;
  if TG_OP='DELETE' then return old;end if;
  if new.status='concluido' and liquido>0 then
    -- Dinheiro vai para a conta do caixa; o resto (ou sem conta do caixa) para a padrão
    if new.pagamento='dinheiro' then
      select id into conta from public.financeiro_contas where padrao_caixa and ativa;
    end if;
    if conta is null then select id into conta from public.financeiro_contas where padrao and ativa; end if;
    if conta is null then raise exception 'Configure uma conta padrão ativa para as vendas.';end if;
    -- Changing the total of a concluded sale retains its original destination.
    if venda.pedido_id is not null and old.status='concluido' then conta:=venda.conta_id;end if;
    detalhe:=case when coalesce(new.tarifa,0)>0 then
      ' (R$ '||replace(to_char(new.total/100.0,'FM999999990.00'),'.',',')||' − tarifa '
      ||coalesce(new.maquininha_nome, case when new.pagamento='pix' then 'Pix' else 'cartão' end)
      ||' R$ '||replace(to_char(new.tarifa/100.0,'FM999999990.00'),'.',',')||')' else '' end;
    insert into public.financeiro_lancamentos(tipo,destino_id,valor,descricao,categoria,pedido_id,pedido_numero)
      values('venda',conta,liquido,'Venda #'||numero||case when new.origem='balcao' then ' · PDV' else ' · Site' end||detalhe,'Vendas',pedido,numero) returning id into lancamento;
    insert into public.financeiro_vendas(pedido_id,conta_id,valor,lancamento_id) values(pedido,conta,liquido,lancamento);
  end if;
  return new;
end;$$;

notify pgrst, 'reload schema';
