-- Equipe do painel: Administrador e Operador.
--
-- A tabela public.admins passa a guardar a EQUIPE, com o papel de cada pessoa:
--   admin     → tudo, como antes (public.is_admin() continua significando isso)
--   operador  → só Pedidos e PDV: vê e muda o status dos pedidos, abre/fecha o
--               caixa e registra vendas no balcão. Não vê custos, relatórios,
--               financeiro, cadastro, estoque nem configurações.
--
-- public.is_equipe() = admin ou operador. Só as telas do operador trocam
-- is_admin() por is_equipe(); o resto continua só para admin.
-- O cadastro de pessoas (criar login) fica na Edge Function "equipe", que usa a
-- chave de serviço só depois de o banco confirmar que quem pediu é admin.

alter table public.admins
  add column if not exists papel text not null default 'admin' check (papel in ('admin', 'operador')),
  add column if not exists nome text not null default '' check (char_length(nome) <= 80);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()) and a.papel = 'admin');
$$;

/** Admin ou operador (quem pode usar Pedidos e PDV). */
create or replace function public.is_equipe()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function privado.exigir_equipe()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_equipe() then
    raise exception 'Sem permissão.';
  end if;
end;
$$;

revoke all on function public.is_equipe() from public;
grant execute on function public.is_equipe() to anon, authenticated;
revoke all on function privado.exigir_equipe() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- PDV e caixa: liberados para a equipe (o corpo das funções não muda,
-- só a checagem de permissão).
-- ---------------------------------------------------------------------
do $$
declare
  f regprocedure;
  def text;
  novo text;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('abrir_caixa', 'movimentar_caixa', 'resumo_caixa', 'fechar_caixa', 'registrar_venda_balcao')
  loop
    def := pg_get_functiondef(f);
    novo := replace(def, 'privado.exigir_admin()', 'privado.exigir_equipe()');
    if novo = def then raise exception 'Função % sem a checagem esperada', f; end if;
    execute novo;
  end loop;

  -- Saldos (o PDV mostra também produtos que não aparecem na vitrine)
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('saldos_venda', 'saldos_opcoes')
  loop
    def := pg_get_functiondef(f);
    novo := replace(def, 'public.is_admin()', 'public.is_equipe()');
    if novo = def then raise exception 'Função % sem a checagem esperada', f; end if;
    execute novo;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Leitura: o que Pedidos e PDV precisam
-- ---------------------------------------------------------------------
drop policy if exists "pedidos_admin_le" on public.pedidos;
create policy "pedidos_equipe_le" on public.pedidos for select to authenticated using ((select public.is_equipe()));
drop policy if exists "pedidos_admin_altera" on public.pedidos;
create policy "pedidos_equipe_altera" on public.pedidos for update to authenticated
  using ((select public.is_equipe())) with check ((select public.is_equipe()));
-- Apagar pedido continua só para admin (pedidos_admin_remove)

drop policy if exists "produtos_leitura" on public.produtos;
create policy "produtos_leitura" on public.produtos for select to anon, authenticated using (ativo or (select public.is_equipe()));
drop policy if exists "categorias_leitura" on public.categorias;
create policy "categorias_leitura" on public.categorias for select to anon, authenticated using (ativa or (select public.is_equipe()));
drop policy if exists kit_componentes_admin_le on public.kit_componentes;
create policy kit_componentes_equipe_le on public.kit_componentes for select to authenticated using ((select public.is_equipe()));
drop policy if exists "caixas_admin_le" on public.caixas;
create policy "caixas_equipe_le" on public.caixas for select to authenticated using ((select public.is_equipe()));
drop policy if exists "caixa_movimentos_admin_le" on public.caixa_movimentos;
create policy "caixa_movimentos_equipe_le" on public.caixa_movimentos for select to authenticated using ((select public.is_equipe()));

-- O custo dos produtos já não é liberado para leitura direta (permissão por coluna),
-- então o operador vê os produtos ocultos no PDV, mas não o custo.

/**
 * Pelo painel (API direta), o operador só muda o STATUS do pedido.
 * Funções do banco (security definer) e o admin não passam por esta trava.
 */
create or replace function privado.pedidos_operador_so_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not public.is_admin()
     and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'O operador só pode mudar o status do pedido.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function privado.pedidos_operador_so_status() from public, anon, authenticated;
drop trigger if exists pedidos_a_operador_so_status on public.pedidos;
-- Nome com "a_" para rodar antes dos outros gatilhos BEFORE (ordem alfabética)
create trigger pedidos_a_operador_so_status before update on public.pedidos
  for each row execute function privado.pedidos_operador_so_status();

-- ---------------------------------------------------------------------
-- Cadastro da equipe (só admin)
-- ---------------------------------------------------------------------

/** Equipe com e-mail e último acesso. */
create or replace function public.equipe_listar()
returns table (user_id uuid, email text, nome text, papel text, criado_em timestamptz, ultimo_acesso timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
    select a.user_id, u.email::text, a.nome, a.papel, a.criado_em, u.last_sign_in_at
      from public.admins a
      join auth.users u on u.id = a.user_id
     order by a.papel, lower(coalesce(nullif(a.nome, ''), u.email::text));
end;
$$;

create or replace function privado.equipe_validar(p_nome text, p_papel text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_papel is null or p_papel not in ('admin', 'operador') then raise exception 'Escolha o papel: administrador ou operador.'; end if;
  if char_length(btrim(coalesce(p_nome, ''))) not between 1 and 80 then raise exception 'Informe o nome (até 80 letras).'; end if;
end;
$$;

create or replace function privado.equipe_exigir_um_admin()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admins where papel = 'admin') then
    raise exception 'A loja precisa de pelo menos um administrador.';
  end if;
end;
$$;

/**
 * Coloca na equipe um login que já existe (a Edge Function cria o login antes,
 * se precisar). Chamada com o login do ADMIN que está cadastrando.
 */
create or replace function public.equipe_vincular(p_email text, p_nome text, p_papel text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  usuario uuid;
begin
  perform privado.exigir_admin();
  perform privado.equipe_validar(p_nome, p_papel);
  perform pg_advisory_xact_lock(11011013);
  select id into usuario from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if usuario is null then raise exception 'Login não encontrado para esse e-mail.'; end if;
  if exists (select 1 from public.admins where user_id = usuario) then raise exception 'Esse e-mail já faz parte da equipe.'; end if;
  insert into public.admins (user_id, nome, papel) values (usuario, btrim(p_nome), p_papel);
  return usuario;
end;
$$;

/** Muda nome e papel de alguém da equipe. */
create or replace function public.equipe_salvar(p_user uuid, p_nome text, p_papel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  perform privado.equipe_validar(p_nome, p_papel);
  perform pg_advisory_xact_lock(11011013);
  update public.admins set nome = btrim(p_nome), papel = p_papel where user_id = p_user;
  if not found then raise exception 'Essa pessoa não faz parte da equipe.'; end if;
  perform privado.equipe_exigir_um_admin();
end;
$$;

/** Tira o acesso ao painel (o login continua existindo, mas não entra mais). */
create or replace function public.equipe_remover(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011013);
  if p_user = (select auth.uid()) then raise exception 'Você não pode tirar o seu próprio acesso.'; end if;
  delete from public.admins where user_id = p_user;
  if not found then raise exception 'Essa pessoa não faz parte da equipe.'; end if;
  perform privado.equipe_exigir_um_admin();
end;
$$;

/** Para a Edge Function conferir, antes de trocar a senha, que a pessoa é da equipe. */
create or replace function public.equipe_membro(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return exists (select 1 from public.admins where user_id = p_user);
end;
$$;

revoke all on function public.equipe_listar() from public, anon;
revoke all on function public.equipe_vincular(text, text, text) from public, anon;
revoke all on function public.equipe_salvar(uuid, text, text) from public, anon;
revoke all on function public.equipe_remover(uuid) from public, anon;
revoke all on function public.equipe_membro(uuid) from public, anon;
revoke all on function privado.equipe_validar(text, text) from public, anon, authenticated;
revoke all on function privado.equipe_exigir_um_admin() from public, anon, authenticated;
grant execute on function public.equipe_listar() to authenticated;
grant execute on function public.equipe_vincular(text, text, text) to authenticated;
grant execute on function public.equipe_salvar(uuid, text, text) to authenticated;
grant execute on function public.equipe_remover(uuid) to authenticated;
grant execute on function public.equipe_membro(uuid) to authenticated;

notify pgrst, 'reload schema';
