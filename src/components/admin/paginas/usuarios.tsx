"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { emailValido, ordenarEquipe, PAPEIS, problemaNaSenha, type MembroEquipe } from "@/lib/admin/equipe";
import type { Papel } from "@/lib/admin/sessao";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CabecalhoPagina, Carregando, Confirmar, Vazio } from "../ui";

type Acao = { tipo: "novo" } | { tipo: "editar"; membro: MembroEquipe } | { tipo: "senha"; membro: MembroEquipe };

const fmtAcesso = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Mensagem de erro da Edge Function (corpo { erro }) ou uma genérica. */
async function erroDaFuncao(error: unknown, padrao: string): Promise<string> {
  const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
  return typeof corpo?.erro === "string" ? corpo.erro : padrao;
}

export function PaginaUsuarios() {
  const [equipe, setEquipe] = useState<MembroEquipe[] | null>(null);
  const [eu, setEu] = useState<string | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [operando, setOperando] = useState(false);
  const [versao, setVersao] = useState(0);
  const atualizar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    void sb.auth.getUser().then(({ data }) => ativo && setEu(data.user?.id ?? null));
    sb.rpc("equipe_listar").then(({ data, error }) => {
      if (!ativo) return;
      if (error) {
        toast.error(`Erro ao carregar usuários: ${error.message}`);
        setEquipe([]);
        return;
      }
      setEquipe(ordenarEquipe((data ?? []) as MembroEquipe[]));
    });
    return () => {
      ativo = false;
    };
  }, [versao]);

  const remover = async (m: MembroEquipe) => {
    const { error } = await supabaseNavegador().rpc("equipe_remover", { p_user: m.user_id });
    if (error) return void toast.error(error.message);
    toast.success(`${m.nome || m.email} não entra mais no painel`);
    atualizar();
  };

  return (
    <div>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Quem entra no painel. Cada pessoa tem o próprio login, e o papel define o que ela pode ver."
        acoes={<Button onClick={() => setAcao({ tipo: "novo" })}><Plus /> Novo usuário</Button>}
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {(Object.keys(PAPEIS) as Papel[]).map((p) => (
          <div key={p} className="flex gap-3 rounded-card border border-borda bg-superficie p-3 text-sm">
            {p === "admin" ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-rosa-texto" aria-hidden /> : <UserRound className="mt-0.5 size-5 shrink-0 text-suave" aria-hidden />}
            <p><span className="font-bold">{PAPEIS[p].nome}:</span> <span className="text-suave">{PAPEIS[p].descricao}</span></p>
          </div>
        ))}
      </div>

      {equipe === null ? (
        <Carregando texto="Carregando usuários…" />
      ) : equipe.length === 0 ? (
        <Vazio titulo="Ninguém na equipe" texto="Cadastre o primeiro usuário." />
      ) : (
        <ul aria-label="Usuários do painel" className="divide-y divide-borda overflow-hidden rounded-card border border-borda bg-superficie">
          {equipe.map((m) => {
            const souEu = m.user_id === eu;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    <span className="truncate">{m.nome || m.email}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[0.7rem] font-bold uppercase", m.papel === "admin" ? "bg-rosa/15 text-rosa-texto" : "bg-superficie-3 text-suave")}>
                      {PAPEIS[m.papel].nome}
                    </span>
                    {souEu && <span className="text-xs font-medium text-suave">(você)</span>}
                  </p>
                  <p className="truncate text-sm text-suave">{m.email}</p>
                  <p className="text-xs text-suave">{m.ultimo_acesso ? `Último acesso: ${fmtAcesso.format(new Date(m.ultimo_acesso))}` : "Ainda não entrou"}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="suave" onClick={() => setAcao({ tipo: "editar", membro: m })} aria-label={`Editar ${m.nome || m.email}`}>
                    <Pencil /> Editar
                  </Button>
                  <Button size="sm" variant="suave" onClick={() => setAcao({ tipo: "senha", membro: m })} aria-label={`Trocar a senha de ${m.nome || m.email}`}>
                    <KeyRound /> Senha
                  </Button>
                  {!souEu && (
                    <Confirmar
                      titulo="Tirar o acesso?"
                      descricao={`${m.nome || m.email} não vai mais entrar no painel. Os pedidos e vendas que essa pessoa fez continuam registrados.`}
                      rotuloConfirmar="Tirar acesso"
                      onConfirmar={() => remover(m)}
                    >
                      <Button size="icone-sm" variant="fantasma" aria-label={`Tirar o acesso de ${m.nome || m.email}`} title="Tirar acesso">
                        <Trash2 />
                      </Button>
                    </Confirmar>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!acao} onOpenChange={(v) => { if (!v && !operando) setAcao(null); }}>
        <SheetContent lado="centro" className="max-w-lg">
          <SheetTitle className="sr-only">{acao?.tipo === "novo" ? "Novo usuário" : acao?.tipo === "senha" ? "Trocar senha" : "Editar usuário"}</SheetTitle>
          <SheetDescription className="sr-only">Confira os dados antes de salvar.</SheetDescription>
          {acao && (
            <FormularioUsuario
              key={acao.tipo + (acao.tipo === "novo" ? "" : acao.membro.user_id)}
              acao={acao}
              souEu={acao.tipo !== "novo" && acao.membro.user_id === eu}
              onOperando={setOperando}
              onCancelar={() => setAcao(null)}
              onSalvo={() => { setAcao(null); atualizar(); }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FormularioUsuario({
  acao,
  souEu,
  onOperando,
  onCancelar,
  onSalvo,
}: {
  acao: Acao;
  souEu: boolean;
  onOperando: (v: boolean) => void;
  onCancelar: () => void;
  onSalvo: () => void;
}) {
  const membro = acao.tipo === "novo" ? null : acao.membro;
  const [nome, setNome] = useState(membro?.nome ?? "");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<Papel>(membro?.papel ?? "operador");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const emSalvar = useRef(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emSalvar.current) return;
    if (acao.tipo !== "senha" && !nome.trim()) return setErro("Informe o nome.");
    if (acao.tipo === "novo" && !emailValido(email)) return setErro("Informe um e-mail válido.");
    if (acao.tipo !== "editar") {
      const problema = problemaNaSenha(senha);
      if (problema) return setErro(problema);
    }
    emSalvar.current = true;
    setSalvando(true);
    onOperando(true);
    setErro(null);
    try {
      const sb = supabaseNavegador();
      if (acao.tipo === "novo") {
        const { data, error } = await sb.functions.invoke("equipe", { body: { email: email.trim(), nome: nome.trim(), papel, senha } });
        if (error) return void setErro(await erroDaFuncao(error, "Não foi possível cadastrar agora."));
        toast.success(
          (data as { ja_existia?: boolean } | null)?.ja_existia
            ? `${nome.trim()} entrou na equipe. Esse e-mail já tinha login, então a senha dele continua a mesma.`
            : `${nome.trim()} cadastrado. Passe o e-mail e a senha para a pessoa entrar em /admin.`,
        );
      } else if (acao.tipo === "senha") {
        const { error } = await sb.functions.invoke("equipe/senha", { body: { user_id: acao.membro.user_id, senha } });
        if (error) return void setErro(await erroDaFuncao(error, "Não foi possível trocar a senha agora."));
        toast.success(`Senha de ${acao.membro.nome || acao.membro.email} trocada`);
      } else {
        const { error } = await sb.rpc("equipe_salvar", { p_user: acao.membro.user_id, p_nome: nome.trim(), p_papel: papel });
        if (error) return void setErro(error.message);
        toast.success("Usuário atualizado");
        // Mudou o próprio papel: recarrega para o menu acompanhar
        if (souEu && papel !== acao.membro.papel) window.location.assign("/admin");
      }
      onSalvo();
    } catch {
      setErro("Falha de conexão. Os dados continuam aqui; tente de novo.");
    } finally {
      emSalvar.current = false;
      setSalvando(false);
      onOperando(false);
    }
  };

  const titulo = acao.tipo === "novo" ? "Novo usuário" : acao.tipo === "senha" ? `Nova senha de ${acao.membro.nome || acao.membro.email}` : "Editar usuário";

  return (
    <form onSubmit={enviar} noValidate className="flex min-h-0 flex-col">
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 pt-5 pb-6">
        <h2 className="pr-9 text-lg font-semibold">{titulo}</h2>
        {erro && <p role="alert" className="rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro}</p>}
        <fieldset disabled={salvando} className="space-y-4">
          {acao.tipo !== "senha" && (
            <Campo label="Nome" htmlFor="usu-nome">
              <Input id="usu-nome" required maxLength={80} autoComplete="off" value={nome} placeholder="Ex.: Maria do caixa" onChange={(e) => setNome(e.target.value)} />
            </Campo>
          )}
          {acao.tipo === "novo" && (
            <Campo label="E-mail (é o login)" htmlFor="usu-email">
              <Input id="usu-email" type="email" required maxLength={254} autoComplete="off" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Campo>
          )}
          {acao.tipo === "editar" && <p className="text-sm text-suave">Login: {acao.membro.email}</p>}

          {acao.tipo !== "senha" && (
            <fieldset>
              <legend className="mb-2 text-sm font-bold">Papel</legend>
              <div className="grid gap-2">
                {(Object.keys(PAPEIS) as Papel[]).map((p) => (
                  <label key={p} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", papel === p ? "border-rosa bg-rosa/10" : "border-borda bg-superficie-2")}>
                    <input type="radio" name="usu-papel" value={p} checked={papel === p} onChange={() => setPapel(p)} className="mt-0.5 size-4 accent-rosa" />
                    <span><span className="block font-bold">{PAPEIS[p].nome}</span><span className="text-suave">{PAPEIS[p].descricao}</span></span>
                  </label>
                ))}
              </div>
              {souEu && papel === "operador" && acao.tipo === "editar" && acao.membro.papel === "admin" && (
                <p className="mt-2 text-sm text-perigo">Você vai perder o acesso às telas de administrador.</p>
              )}
            </fieldset>
          )}

          {acao.tipo !== "editar" && (
            <Campo label={acao.tipo === "novo" ? "Senha inicial" : "Nova senha"} htmlFor="usu-senha" ajuda="De 8 a 72 caracteres, com letras e números. A pessoa pode trocar depois em “Esqueci a senha”.">
              <div className="relative">
                <Input id="usu-senha" type={verSenha ? "text" : "password"} required minLength={8} maxLength={72} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} className="pr-11" />
                <button type="button" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? "Esconder senha" : "Mostrar senha"} aria-pressed={verSenha}
                  className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center text-suave hover:text-texto">
                  {verSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Campo>
          )}
        </fieldset>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-borda px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="suave" disabled={salvando} onClick={onCancelar}>Voltar</Button>
        <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : acao.tipo === "novo" ? "Cadastrar" : "Salvar"}</Button>
      </div>
    </form>
  );
}
