-- Horários de "manter o site acordado": margens, meia-noite e loja fechada.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/manter_servidor_acordado.sql
begin;
do $test$
declare
  -- Seg–qui 14–21, sex 10–00 (meia-noite), sáb 18–02 (passa da meia-noite), dom fechado
  h jsonb := '{"1":[{"abre":"14:00","fecha":"21:00"}],"2":[{"abre":"14:00","fecha":"21:00"}],"3":[{"abre":"14:00","fecha":"21:00"}],
               "4":[{"abre":"14:00","fecha":"21:00"}],"5":[{"abre":"10:00","fecha":"00:00"}],"6":[{"abre":"18:00","fecha":"02:00"}]}';
  caso record;
begin
  update public.configuracoes set horarios=h, status_manual='auto' where id=1;
  -- 2026-11-16 é segunda; horários em São Paulo (-03)
  for caso in select * from (values
    ('2026-11-16 13:20-03', false, 'seg antes da margem'),
    ('2026-11-16 13:30-03', true,  'seg 30 min antes de abrir'),
    ('2026-11-16 20:59-03', true,  'seg aberta'),
    ('2026-11-16 21:14-03', true,  'seg 15 min depois de fechar'),
    ('2026-11-16 21:16-03', false, 'seg depois da margem'),
    ('2026-11-20 23:50-03', true,  'sex até meia-noite'),
    ('2026-11-21 00:10-03', true,  'sáb 00:10 (margem da sexta)'),
    ('2026-11-21 00:20-03', false, 'sáb 00:20'),
    ('2026-11-22 01:30-03', true,  'dom 01:30 (sábado passa da meia-noite)'),
    ('2026-11-22 03:00-03', false, 'dom 03:00'),
    ('2026-11-22 12:00-03', false, 'domingo sem horário')
  ) v(quando, esperado, nome) loop
    if privado.loja_no_horario(p_agora => caso.quando::timestamptz) is distinct from caso.esperado then
      raise exception 'FAIL %', caso.nome;
    end if;
  end loop;
  update public.configuracoes set status_manual='fechada' where id=1;
  if privado.loja_no_horario(p_agora => '2026-11-16 15:00-03') then raise exception 'FAIL loja fechada no painel'; end if;
end;$test$;
rollback;
select 'PASS: acorda 30 min antes de abrir até 15 min depois de fechar, meia-noite e madrugada, domingo sem horário e loja fechada. Dados desfeitos.' as resultado;
