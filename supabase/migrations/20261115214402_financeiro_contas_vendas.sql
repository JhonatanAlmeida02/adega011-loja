-- Ledger in integer cents. Existing sales are deliberately not backfilled.
create table public.financeiro_config (
  id integer primary key check(id=1), iniciado_em timestamptz not null default now()
);
insert into public.financeiro_config(id) values(1);
create table public.financeiro_contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check(char_length(btrim(nome)) between 1 and 80),
  tipo text not null check(tipo in ('caixa','banco','carteira','outro')),
  padrao boolean not null default false, ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  check(not padrao or ativa)
);
create unique index financeiro_conta_nome on public.financeiro_contas(lower(btrim(nome)));
create unique index financeiro_conta_padrao on public.financeiro_contas(padrao) where padrao;
insert into public.financeiro_contas(nome,tipo,padrao) values('Conta padrão de vendas','carteira',true);
create table public.financeiro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check(tipo in ('abertura','entrada','saida','transferencia','venda','estorno_venda','ajuste','estorno')),
  origem_id uuid references public.financeiro_contas(id), destino_id uuid references public.financeiro_contas(id),
  valor bigint not null check(valor>0 and valor<=1000000000000),
  descricao text not null check(char_length(btrim(descricao)) between 1 and 300),
  categoria text not null default '' check(char_length(categoria)<=80),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now(), criado_por uuid default auth.uid(),
  pedido_id uuid references public.pedidos(id) on delete set null, pedido_numero bigint,
  estorno_de uuid unique references public.financeiro_lancamentos(id),
  check(origem_id is not null or destino_id is not null),
  check(origem_id is distinct from destino_id),
  check((tipo='transferencia' and origem_id is not null and destino_id is not null)
    or (tipo in ('entrada','abertura','venda') and origem_id is null and destino_id is not null)
    or (tipo in ('saida','estorno_venda') and origem_id is not null and destino_id is null)
    or tipo in ('ajuste','estorno')),
  check((tipo in ('estorno','estorno_venda'))=(estorno_de is not null))
);
create index financeiro_lancamentos_data on public.financeiro_lancamentos(data desc,criado_em desc,id);
create index financeiro_lancamentos_origem on public.financeiro_lancamentos(origem_id,data desc);
create index financeiro_lancamentos_destino on public.financeiro_lancamentos(destino_id,data desc);
create index financeiro_lancamentos_pedido on public.financeiro_lancamentos(pedido_id);
create table public.financeiro_vendas (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  conta_id uuid not null references public.financeiro_contas(id),
  valor bigint not null, lancamento_id uuid not null unique references public.financeiro_lancamentos(id)
);
create index financeiro_vendas_conta on public.financeiro_vendas(conta_id);

alter table public.financeiro_config enable row level security;
alter table public.financeiro_contas enable row level security;
alter table public.financeiro_lancamentos enable row level security;
alter table public.financeiro_vendas enable row level security;
revoke all on public.financeiro_config,public.financeiro_contas,public.financeiro_lancamentos,public.financeiro_vendas from public,anon,authenticated;
grant select on public.financeiro_config,public.financeiro_contas,public.financeiro_lancamentos,public.financeiro_vendas to authenticated;
create policy financeiro_config_admin on public.financeiro_config for select to authenticated using ((select public.is_admin()));
create policy financeiro_contas_admin on public.financeiro_contas for select to authenticated using ((select public.is_admin()));
create policy financeiro_lancamentos_admin on public.financeiro_lancamentos for select to authenticated using ((select public.is_admin()));
create policy financeiro_vendas_admin on public.financeiro_vendas for select to authenticated using ((select public.is_admin()));
create view public.financeiro_saldos with(security_invoker=true) as
select c.*,coalesce(s.saldo,0)::bigint as saldo from public.financeiro_contas c
left join (
  select conta_id,sum(valor)::bigint as saldo from (
    select destino_id as conta_id,valor from public.financeiro_lancamentos where destino_id is not null
    union all select origem_id,-valor from public.financeiro_lancamentos where origem_id is not null
  ) m group by conta_id
) s on s.conta_id=c.id;
revoke all on public.financeiro_saldos from public,anon,authenticated;
grant select on public.financeiro_saldos to authenticated;

-- All finance writers use this lock. No writer touches orders/stock, so the
-- existing order/stock -> finance lock order cannot form a deadlock cycle.
create function public.financeiro_salvar_conta(p_id uuid,p_nome text,p_tipo text,p_padrao boolean,p_ativa boolean,p_saldo_inicial bigint default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare atual public.financeiro_contas%rowtype;
begin
  perform privado.exigir_admin();perform pg_advisory_xact_lock(11011012);
  if p_id is null or p_nome is null or char_length(btrim(p_nome)) not between 1 and 80 or p_tipo is null or p_tipo not in ('caixa','banco','carteira','outro') or p_padrao is null or p_ativa is null or p_saldo_inicial is null or p_saldo_inicial not between 0 and 1000000000000 then raise exception 'Confira o nome, tipo e saldo da conta.';end if;
  select * into atual from public.financeiro_contas where id=p_id;
  if exists(select 1 from public.financeiro_contas c where lower(btrim(c.nome))=lower(btrim(p_nome)) and c.id<>p_id) then raise exception 'Já existe uma conta com esse nome.';end if;
  if p_padrao and not p_ativa then raise exception 'A conta padrão precisa estar ativa.';end if;
  if atual.padrao and not p_padrao then raise exception 'Escolha outra conta como padrão antes de retirar esta.';end if;
  if p_padrao then update public.financeiro_contas set padrao=false where padrao and id<>p_id;end if;
  if atual.id is not null then
    if not p_ativa and exists(select 1 from public.financeiro_saldos where id=p_id and saldo<>0) then raise exception 'Transfira ou confira o saldo antes de desativar a conta.';end if;
    update public.financeiro_contas set nome=btrim(p_nome),tipo=p_tipo,padrao=p_padrao,ativa=p_ativa where id=p_id;
  else
    if not p_ativa and p_saldo_inicial>0 then raise exception 'Uma conta com saldo inicial precisa estar ativa.';end if;
    insert into public.financeiro_contas(id,nome,tipo,padrao,ativa) values(p_id,btrim(p_nome),p_tipo,p_padrao,p_ativa);
    if p_saldo_inicial>0 then insert into public.financeiro_lancamentos(id,tipo,destino_id,valor,descricao,categoria) values(p_id,'abertura',p_id,p_saldo_inicial,'Saldo inicial','Saldo inicial');end if;
  end if;
  return p_id;
end;$$;

create function public.financeiro_lancar(p_id uuid,p_tipo text,p_origem uuid,p_destino uuid,p_valor bigint,p_descricao text,p_categoria text,p_data date)
returns uuid language plpgsql security definer set search_path='' as $$
declare atual public.financeiro_lancamentos%rowtype;
begin
  perform privado.exigir_admin();perform pg_advisory_xact_lock(11011012);
  if p_id is null or p_tipo is null or p_tipo not in ('entrada','saida','transferencia') or p_valor is null or p_valor not between 1 and 1000000000000 or p_descricao is null or char_length(btrim(p_descricao)) not between 1 and 300 or p_categoria is null or char_length(p_categoria)>80 or p_data is null or p_data>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Confira tipo, valor, descrição e data do lançamento.';end if;
  if (p_tipo='entrada' and (p_origem is not null or p_destino is null)) or (p_tipo='saida' and (p_origem is null or p_destino is not null)) or (p_tipo='transferencia' and (p_origem is null or p_destino is null or p_origem=p_destino)) then raise exception 'Selecione contas diferentes e compatíveis com o lançamento.';end if;
  select * into atual from public.financeiro_lancamentos where id=p_id;
  if found then
    if atual.tipo=p_tipo and atual.origem_id is not distinct from p_origem and atual.destino_id is not distinct from p_destino and atual.valor=p_valor and atual.descricao=btrim(p_descricao) and atual.categoria=btrim(p_categoria) and atual.data=p_data then return p_id;end if;
    raise exception 'Este lançamento já existe com outros dados. Reabra o formulário.';
  end if;
  if exists(select 1 from unnest(array[p_origem,p_destino]) c where c is not null and not exists(select 1 from public.financeiro_contas where id=c and ativa)) then raise exception 'Selecione uma conta ativa.';end if;
  insert into public.financeiro_lancamentos(id,tipo,origem_id,destino_id,valor,descricao,categoria,data)
    values(p_id,p_tipo,p_origem,p_destino,p_valor,btrim(p_descricao),btrim(p_categoria),p_data);
  return p_id;
end;$$;

create function public.financeiro_conferir_saldo(p_id uuid,p_conta uuid,p_saldo bigint,p_esperado bigint,p_motivo text)
returns uuid language plpgsql security definer set search_path='' as $$
declare saldo_atual bigint; diferenca bigint;
begin
  perform privado.exigir_admin();perform pg_advisory_xact_lock(11011012);
  if p_id is null or p_conta is null or p_saldo is null or abs(p_saldo::numeric)>1000000000000 or p_esperado is null or p_motivo is null or char_length(btrim(p_motivo)) not between 1 and 250 then raise exception 'Informe saldo conferido e motivo.';end if;
  if exists(select 1 from public.financeiro_lancamentos where id=p_id) then
    if exists(select 1 from public.financeiro_lancamentos where id=p_id and tipo='ajuste' and coalesce(origem_id,destino_id)=p_conta and valor=abs(p_saldo-p_esperado) and descricao='Conferência: '||btrim(p_motivo) and (destino_id is not null)=(p_saldo>p_esperado)) then return p_id;end if;
    raise exception 'Identificador já utilizado.';
  end if;
  select saldo into saldo_atual from public.financeiro_saldos where id=p_conta and ativa;
  if not found then raise exception 'Conta não encontrada ou inativa.';end if;
  if saldo_atual<>p_esperado then raise exception 'O saldo mudou durante a conferência. Atualize e confira novamente.';end if;
  diferenca:=p_saldo-saldo_atual;
  if diferenca=0 then return p_id;end if;
  if abs(diferenca::numeric)>1000000000000 then raise exception 'Diferença de saldo muito grande.';end if;
  insert into public.financeiro_lancamentos(id,tipo,origem_id,destino_id,valor,descricao,categoria)
    values(p_id,'ajuste',case when diferenca<0 then p_conta end,case when diferenca>0 then p_conta end,abs(diferenca),'Conferência: '||btrim(p_motivo),'Conferência de saldo');
  return p_id;
end;$$;

create function public.financeiro_estornar(p_id uuid,p_motivo text)
returns uuid language plpgsql security definer set search_path='' as $$
declare atual public.financeiro_lancamentos%rowtype; novo uuid;
begin
  perform privado.exigir_admin();perform pg_advisory_xact_lock(11011012);
  select * into atual from public.financeiro_lancamentos where id=p_id;
  if not found or atual.tipo not in ('entrada','saida','transferencia','ajuste') then raise exception 'Este lançamento não pode ser estornado aqui. Vendas são estornadas pelo cancelamento do pedido.';end if;
  if p_motivo is null or char_length(btrim(p_motivo)) not between 1 and 250 then raise exception 'Informe o motivo do estorno.';end if;
  select id into novo from public.financeiro_lancamentos where estorno_de=p_id;
  if novo is not null then return novo;end if;
  insert into public.financeiro_lancamentos(tipo,origem_id,destino_id,valor,descricao,categoria,estorno_de)
    values('estorno',atual.destino_id,atual.origem_id,atual.valor,'Estorno: '||btrim(p_motivo),atual.categoria,p_id) returning id into novo;
  return novo;
end;$$;

create function privado.financeiro_por_pedido() returns trigger language plpgsql security definer set search_path='' as $$
declare venda public.financeiro_vendas%rowtype; conta uuid; lancamento uuid; pedido uuid; numero bigint;
begin
  if TG_OP='UPDATE' and new.status is not distinct from old.status and new.total is not distinct from old.total then return new;end if;
  if TG_OP<>'DELETE' and new.status<>'concluido' and not exists(select 1 from public.financeiro_vendas where pedido_id=new.id) then return new;end if;
  pedido:=case when TG_OP='DELETE' then old.id else new.id end;
  numero:=case when TG_OP='DELETE' then old.numero else new.numero end;
  perform pg_advisory_xact_lock(11011012);
  select * into venda from public.financeiro_vendas where pedido_id=pedido;
  if TG_OP='UPDATE' and old.status='concluido' and new.status='concluido' and venda.pedido_id is null
    and old.criado_em<(select iniciado_em from public.financeiro_config where id=1) then return new;end if;
  if TG_OP<>'DELETE' and new.status='concluido' and venda.pedido_id is not null and venda.valor=new.total then return new;end if;
  if venda.pedido_id is not null then
    insert into public.financeiro_lancamentos(tipo,origem_id,valor,descricao,categoria,pedido_id,pedido_numero,estorno_de)
      values('estorno_venda',venda.conta_id,venda.valor,'Estorno da venda #'||numero,'Vendas',pedido,numero,venda.lancamento_id);
    delete from public.financeiro_vendas where pedido_id=pedido;
  end if;
  if TG_OP='DELETE' then return old;end if;
  if new.status='concluido' and new.total>0 then
    select id into conta from public.financeiro_contas where padrao and ativa;
    if conta is null then raise exception 'Configure uma conta padrão ativa para as vendas.';end if;
    -- Changing the total of a concluded sale retains its original destination.
    if venda.pedido_id is not null and old.status='concluido' then conta:=venda.conta_id;end if;
    insert into public.financeiro_lancamentos(tipo,destino_id,valor,descricao,categoria,pedido_id,pedido_numero)
      values('venda',conta,new.total,'Venda #'||numero||case when new.origem='balcao' then ' · PDV' else ' · Site' end,'Vendas',pedido,numero) returning id into lancamento;
    insert into public.financeiro_vendas(pedido_id,conta_id,valor,lancamento_id) values(pedido,conta,new.total,lancamento);
  end if;
  return new;
end;$$;
revoke all on function privado.financeiro_por_pedido() from public,anon,authenticated;
create trigger pedidos_financeiro after insert or update of status,total on public.pedidos for each row execute function privado.financeiro_por_pedido();
create trigger pedidos_financeiro_exclusao before delete on public.pedidos for each row execute function privado.financeiro_por_pedido();

create function public.financeiro_painel(p_inicio date,p_fim date,p_conta uuid default null,p_pagina integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare contas jsonb; registros jsonb; resumo jsonb; quantidade bigint;
begin
  perform privado.exigir_admin();
  if p_inicio is null or p_fim is null or p_inicio>p_fim or p_fim-p_inicio>3660 or p_pagina is null or p_pagina not between 1 and 100000 then raise exception 'Confira o período e a página.';end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.padrao desc,c.ativa desc,c.nome),'[]') into contas from public.financeiro_saldos c;
  select count(*) into quantidade from public.financeiro_lancamentos l where l.data between p_inicio and p_fim and (p_conta is null or p_conta in (l.origem_id,l.destino_id));
  select jsonb_build_object(
    'entradas',coalesce(sum(l.valor) filter(where l.destino_id is not null),0),
    'saidas',coalesce(sum(l.valor) filter(where l.origem_id is not null),0)
  ) into resumo from public.financeiro_lancamentos l left join public.financeiro_lancamentos original on original.id=l.estorno_de
  where l.data between p_inicio and p_fim and (p_conta is null or p_conta in (l.origem_id,l.destino_id))
    and (l.tipo in ('entrada','saida','venda','estorno_venda') or (l.tipo='estorno' and original.tipo in ('entrada','saida')));
  select coalesce(jsonb_agg(to_jsonb(t) order by t.data desc,t.criado_em desc,t.id),'[]') into registros from (
    select l.*,o.nome as origem_nome,d.nome as destino_nome,exists(select 1 from public.financeiro_lancamentos e where e.estorno_de=l.id) as estornado
    from public.financeiro_lancamentos l left join public.financeiro_contas o on o.id=l.origem_id left join public.financeiro_contas d on d.id=l.destino_id
    where l.data between p_inicio and p_fim and (p_conta is null or p_conta in (l.origem_id,l.destino_id))
    order by l.data desc,l.criado_em desc,l.id limit 50 offset (p_pagina-1)*50
  )t;
  return jsonb_build_object('contas',contas,'lancamentos',registros,'resumo',resumo,'total',quantidade,'iniciado_em',(select iniciado_em from public.financeiro_config where id=1));
end;$$;

create function public.financeiro_historico_vendas(p_inicio date,p_fim date,p_pagina integer default 1,p_busca text default '',p_origem text default '',p_status text default '',p_pagamento text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare registros jsonb; quantidade bigint; valor bigint; concluidos bigint;
begin
  perform privado.exigir_admin();
  if p_inicio is null or p_fim is null or p_inicio>p_fim or p_fim-p_inicio>3660 or p_pagina is null or p_pagina not between 1 and 100000 or char_length(coalesce(p_busca,''))>100 then raise exception 'Confira os filtros do histórico.';end if;
  if p_origem not in ('','site','balcao') or p_status not in ('','novo','confirmado','em_entrega','concluido','cancelado') or p_pagamento not in ('','pix','dinheiro','cartao') then raise exception 'Filtros inválidos.';end if;
  with filtrados as (
    select p.* from public.pedidos p where p.criado_em>=(p_inicio::timestamp at time zone 'America/Sao_Paulo') and p.criado_em<((p_fim+1)::timestamp at time zone 'America/Sao_Paulo')
      and (p_origem='' or p.origem=p_origem) and (p_status='' or p.status=p_status) and (p_pagamento='' or p.pagamento=p_pagamento)
      and (coalesce(p_busca,'')='' or p.cliente_nome ilike '%'||p_busca||'%' or p.numero::text ilike '%'||p_busca||'%')
  ) select count(*),coalesce(sum(total) filter(where status='concluido'),0),count(*) filter(where status='concluido') into quantidade,valor,concluidos from filtrados;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.criado_em desc,t.numero desc),'[]') into registros from (
    select p.id,p.numero,p.criado_em,p.status,p.cliente_nome,p.origem,p.pagamento,p.subtotal,p.desconto,p.taxa,p.total,p.itens,
      c.nome as conta_nome,v.lancamento_id as recebimento_id,
      exists(select 1 from public.financeiro_lancamentos l where l.pedido_id=p.id) as possui_lancamentos
    from public.pedidos p left join public.financeiro_vendas v on v.pedido_id=p.id left join public.financeiro_contas c on c.id=v.conta_id
    where p.criado_em>=(p_inicio::timestamp at time zone 'America/Sao_Paulo') and p.criado_em<((p_fim+1)::timestamp at time zone 'America/Sao_Paulo')
      and (p_origem='' or p.origem=p_origem) and (p_status='' or p.status=p_status) and (p_pagamento='' or p.pagamento=p_pagamento)
      and (coalesce(p_busca,'')='' or p.cliente_nome ilike '%'||p_busca||'%' or p.numero::text ilike '%'||p_busca||'%')
    order by p.criado_em desc,p.numero desc limit 50 offset (p_pagina-1)*50
  )t;
  return jsonb_build_object('vendas',registros,'total',quantidade,'faturamento',valor,'concluidos',concluidos);
end;$$;

revoke all on function public.financeiro_salvar_conta(uuid,text,text,boolean,boolean,bigint),public.financeiro_lancar(uuid,text,uuid,uuid,bigint,text,text,date),public.financeiro_conferir_saldo(uuid,uuid,bigint,bigint,text),public.financeiro_estornar(uuid,text),public.financeiro_painel(date,date,uuid,integer),public.financeiro_historico_vendas(date,date,integer,text,text,text,text) from public,anon;
grant execute on function public.financeiro_salvar_conta(uuid,text,text,boolean,boolean,bigint),public.financeiro_lancar(uuid,text,uuid,uuid,bigint,text,text,date),public.financeiro_conferir_saldo(uuid,uuid,bigint,bigint,text),public.financeiro_estornar(uuid,text),public.financeiro_painel(date,date,uuid,integer),public.financeiro_historico_vendas(date,date,integer,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
