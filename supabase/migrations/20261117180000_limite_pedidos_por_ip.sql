-- Limite de pedidos por conexão (IP), além do limite por telefone.
--
-- O limite de 5 pedidos por telefone a cada 10 min não segura quem inventa
-- telefones: em teste, um script esgotou o estoque de um produto em menos de
-- 1 s mandando pedidos falsos. Agora vale também: no máximo 5 pedidos por
-- conexão (IP) a cada 10 min. Os telefones podem ser inventados; o IP não.
--
-- De onde vem o IP (conferido no projeto em produção):
--   cf-connecting-ip / sb-forwarded-for: postos pela Cloudflare do Supabase,
--     não dá para falsificar (a Cloudflare recusa quem tenta mandar).
--   x-forwarded-for: o COMEÇO pode ser inventado pelo cliente
--     ("1.2.3.4, ip-real"); por isso, se for usado, vale só o último item.
-- Sem cabeçalho (ex.: SQL direto no banco), não há limite por IP.
--
-- Os IPs ficam em privado.pedidos_por_ip (fora da API) e são apagados
-- depois de 1 hora.
--
-- Testes: tests/sql/limite_pedidos_ip.sql e tests/sql/limite_pedidos_concorrencia.sh

create table if not exists privado.pedidos_por_ip (
  ip text not null,
  criado_em timestamptz not null default now()
);
create index if not exists pedidos_por_ip_idx on privado.pedidos_por_ip (ip, criado_em desc);
revoke all on privado.pedidos_por_ip from public, anon, authenticated;

-- IP de quem chamou a API. null fora da API, se o texto não for um IP, ou se
-- for IP de rede interna (ex.: Supabase local no Docker, onde todo mundo
-- chega com o mesmo IP; em produção o IP vem sempre da Cloudflare).
create or replace function privado.ip_cliente()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h json := nullif(current_setting('request.headers', true), '')::json;
  v_texto text;
  v_ip inet;
begin
  if h is null then return null; end if;
  v_texto := btrim(coalesce(
    h ->> 'cf-connecting-ip',
    h ->> 'sb-forwarded-for',
    (regexp_split_to_array(h ->> 'x-forwarded-for', '\s*,\s*'))[cardinality(regexp_split_to_array(h ->> 'x-forwarded-for', '\s*,\s*'))]
  ));
  if v_texto is null or v_texto = '' or char_length(v_texto) > 64 then return null; end if;
  begin
    v_ip := v_texto::inet;
  exception when others then
    return null;
  end;
  if v_ip << any (array['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16',
                        '100.64.0.0/10', '::1/128', 'fc00::/7', 'fe80::/10']::inet[])
     or v_ip = any (array['127.0.0.1', '::1']::inet[]) then
    return null;
  end if;
  return host(v_ip);
end;
$$;
revoke all on function privado.ip_cliente() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.criar_pedido(p_cliente_nome text, p_cliente_telefone text, p_tipo text, p_regiao_id uuid, p_endereco text, p_pagamento text, p_troco_para integer, p_observacoes text, p_itens jsonb, p_cotacao_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cfg public.configuracoes%rowtype;
  v_regiao public.regioes_entrega%rowtype;
  v_cot public.cotacoes_frete%rowtype;
  v_montado jsonb;
  v_itens jsonb;
  v_subtotal integer;
  v_taxa integer := 0;
  v_regiao_nome text;
  v_km numeric(6, 1);
  v_telefone text := regexp_replace(coalesce(p_cliente_telefone, ''), '\D', '', 'g');
  v_recentes integer;
  v_ip text := privado.ip_cliente();
  v_id uuid;
  v_numero bigint;
begin
  select * into v_cfg from public.configuracoes c where c.id = 1;

  -- Aberta/fechada: a mesma regra do site (modo forçado com prazo ou horário
  -- padrão). Tolerância de 10 min depois de fechar, para quem já estava
  -- finalizando o pedido quando deu a hora.
  if not (privado.loja_no_horario(interval '0 minutes', interval '10 minutes')
          or privado.modo_loja(now() - interval '10 minutes') = 'aberta') then
    raise exception 'A loja está fechada no momento.';
  end if;
  if coalesce(btrim(p_cliente_nome), '') = '' or char_length(p_cliente_nome) > 80 then
    raise exception 'Informe seu nome.';
  end if;
  if char_length(v_telefone) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.';
  end if;

  -- Trava de vendas antes de contar: pedidos simultâneos do mesmo telefone
  -- contam um depois do outro (senão todos veem 0 e passam do limite).
  perform pg_advisory_xact_lock(11011011);
  select count(*) into v_recentes from public.pedidos pe
    where pe.cliente_telefone = v_telefone and pe.criado_em > now() - interval '10 minutes';
  if v_recentes >= 5 then
    raise exception 'Muitos pedidos em sequência. Aguarde alguns minutos ou chame no WhatsApp.';
  end if;

  -- Mesmo limite por conexão (IP): telefone qualquer um inventa, a conexão não.
  if v_ip is not null then
    select count(*) into v_recentes from privado.pedidos_por_ip pi
      where pi.ip = v_ip and pi.criado_em > now() - interval '10 minutes';
    if v_recentes >= 5 then
      raise exception 'Muitos pedidos seguidos desta conexão. Aguarde alguns minutos ou chame no WhatsApp.';
    end if;
  end if;

  if p_tipo not in ('entrega', 'retirada') then
    raise exception 'Escolha entrega ou retirada.';
  end if;
  if p_tipo = 'entrega' and not v_cfg.aceita_entrega then
    raise exception 'No momento não estamos fazendo entregas.';
  end if;
  if p_tipo = 'retirada' and not v_cfg.aceita_retirada then
    raise exception 'No momento não estamos aceitando retirada na loja.';
  end if;
  if p_pagamento is null or not (p_pagamento = any (v_cfg.pagamentos)) then
    raise exception 'Forma de pagamento indisponível.';
  end if;

  v_montado := privado.montar_itens(p_itens);
  v_itens := v_montado -> 'itens';
  v_subtotal := (v_montado ->> 'subtotal')::integer;

  if v_subtotal < v_cfg.pedido_minimo then
    raise exception 'O pedido mínimo é de R$ %.', replace(to_char(v_cfg.pedido_minimo / 100.0, 'FM999990.00'), '.', ',');
  end if;

  if p_tipo = 'entrega' then
    if coalesce(btrim(p_endereco), '') = '' then
      raise exception 'Informe o endereço de entrega.';
    end if;
    if v_cfg.modo_frete = 'distancia' then
      select * into v_cot from public.cotacoes_frete c where c.id = p_cotacao_id;
      if not found then
        raise exception 'Calcule a taxa de entrega antes de enviar.';
      end if;
      if v_cot.expira_em < now() then
        raise exception 'A taxa de entrega expirou. Calcule de novo.';
      end if;
      if position(v_cot.endereco in privado.normalizar_endereco(p_endereco)) <> 1 then
        raise exception 'O endereço mudou depois do cálculo da taxa. Calcule de novo.';
      end if;
      if v_cot.km > v_cfg.raio_maximo_km then
        raise exception 'Endereço fora da nossa área de entrega.';
      end if;
      v_taxa := v_cot.taxa;
      v_km := v_cot.km;
      v_regiao_nome := replace(to_char(v_cot.km, 'FM9990.0'), '.', ',') || ' km';
    else
      select * into v_regiao from public.regioes_entrega r where r.id = p_regiao_id and r.ativa;
      if not found then
        raise exception 'Selecione uma região de entrega válida.';
      end if;
      v_taxa := v_regiao.taxa;
      v_regiao_nome := v_regiao.nome;
    end if;
  end if;

  if p_pagamento = 'dinheiro' and p_troco_para is not null and p_troco_para < v_subtotal + v_taxa then
    raise exception 'O valor para troco é menor que o total do pedido.';
  end if;

  insert into public.pedidos (
    cliente_nome, cliente_telefone, tipo, regiao_nome, endereco, pagamento,
    troco_para, observacoes, itens, subtotal, taxa, total, distancia_km, origem
  ) values (
    btrim(p_cliente_nome),
    v_telefone,
    p_tipo,
    v_regiao_nome,
    case when p_tipo = 'entrega' then left(btrim(p_endereco), 300) end,
    p_pagamento,
    case when p_pagamento = 'dinheiro' then p_troco_para end,
    nullif(left(btrim(coalesce(p_observacoes, '')), 500), ''),
    v_itens,
    v_subtotal,
    v_taxa,
    v_subtotal + v_taxa,
    v_km,
    'site'
  )
  returning id, numero into v_id, v_numero;

  perform privado.baixar_estoque(v_id, v_itens, 'pedido', v_numero);

  if v_ip is not null then
    -- Só o necessário para o limite: IPs com mais de 1 hora são apagados.
    delete from privado.pedidos_por_ip pi where pi.criado_em < now() - interval '1 hour';
    insert into privado.pedidos_por_ip (ip) values (v_ip);
  end if;

  return jsonb_build_object(
    'id', v_id,
    'numero', v_numero,
    'subtotal', v_subtotal,
    'taxa', v_taxa,
    'total', v_subtotal + v_taxa,
    'itens', v_itens
  );
end;
$function$;

revoke all on function public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb, uuid) from public;
grant execute on function public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
