"use client";

import { useState } from "react";
import { useConfiguracoes } from "@/lib/admin/config";
import { removerImagem, useUploadsPendentes } from "@/lib/admin/imagens";
import type { Configuracoes } from "@/lib/tipos";
import { Button } from "@/components/ui/button";
import { Campo, Input, Textarea } from "@/components/ui/campos";
import { Banner } from "@/components/loja/banner";
import { CabecalhoPagina, Carregando, Cartao, UploadImagem } from "../ui";

type CamposBanner = Pick<
  Configuracoes,
  "banner_titulo" | "banner_texto" | "banner_botao_texto" | "banner_botao_link" | "banner_imagem_url"
>;

export function PaginaBanner() {
  const { config, gravar } = useConfiguracoes();
  if (!config) return <Carregando />;
  return <FormBanner config={config} gravar={gravar} />;
}

function FormBanner({
  config,
  gravar,
}: {
  config: Configuracoes;
  gravar: (c: Partial<Configuracoes>, msg?: string) => Promise<boolean>;
}) {
  const [f, setF] = useState<CamposBanner>({
    banner_titulo: config.banner_titulo,
    banner_texto: config.banner_texto,
    banner_botao_texto: config.banner_botao_texto,
    banner_botao_link: config.banner_botao_link,
    banner_imagem_url: config.banner_imagem_url,
  });
  const [salvando, setSalvando] = useState(false);
  const uploads = useUploadsPendentes();
  const set = <K extends keyof CamposBanner>(k: K, v: CamposBanner[K]) => setF((x) => ({ ...x, [k]: v }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    const anterior = config.banner_imagem_url;
    const ok = await gravar(
      { ...f, banner_titulo: f.banner_titulo.trim() || "São Paulo no copo" },
      "Banner atualizado na loja",
    );
    setSalvando(false);
    if (ok) {
      // Apaga a imagem antiga e as enviadas que não ficaram no banner salvo.
      if (anterior && anterior !== f.banner_imagem_url) void removerImagem(anterior);
      uploads.concluir(f.banner_imagem_url);
    }
  };

  return (
    <>
      <CabecalhoPagina titulo="Banner" descricao="O destaque do topo da loja. Sem imagem, usamos o grafismo da marca." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Cartao>
          <form onSubmit={enviar} className="space-y-5">
            <Campo label="Título" htmlFor="b-titulo">
              <Input id="b-titulo" value={f.banner_titulo} onChange={(e) => set("banner_titulo", e.target.value)} maxLength={60} />
            </Campo>
            <Campo label="Texto" htmlFor="b-texto">
              <Textarea id="b-texto" value={f.banner_texto} onChange={(e) => set("banner_texto", e.target.value)} maxLength={200} rows={3} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Texto do botão" htmlFor="b-botao" ajuda="Vazio = sem botão">
                <Input id="b-botao" value={f.banner_botao_texto} onChange={(e) => set("banner_botao_texto", e.target.value)} maxLength={30} />
              </Campo>
              <Campo label="Link do botão" htmlFor="b-link" ajuda="#combos, #vinhos… ou https://">
                <Input id="b-link" value={f.banner_botao_link} onChange={(e) => set("banner_botao_link", e.target.value)} maxLength={300} />
              </Campo>
            </div>
            <UploadImagem
              rotulo="Imagem (opcional, horizontal)"
              valor={f.banner_imagem_url}
              onChange={(url) => {
                uploads.registrar(url);
                set("banner_imagem_url", url);
              }}
              pasta="banner"
              proporcao="aspect-[16/9]"
            />
            <Button type="submit" size="lg" className="w-full" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar banner"}
            </Button>
          </form>
        </Cartao>
        <div>
          <p className="rotulo mb-3 text-suave">Pré-visualização</p>
          <div className="-mx-4 lg:sticky lg:top-10">
            <Banner config={{ ...config, ...f }} />
          </div>
        </div>
      </div>
    </>
  );
}
