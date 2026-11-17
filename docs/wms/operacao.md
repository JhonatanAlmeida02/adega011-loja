# WMS · Manual do operador e do supervisor

Endereço: `/wms`. Cada pessoa entra com o próprio usuário. Em coletor compartilhado, toque em **Sair** ao terminar o turno.

## Leitura de códigos

- Aponte o leitor para o campo grande da tela (ele já fica selecionado). O leitor "digita" o código e manda **Enter**; se o seu leitor manda **Tab** ou nada, ajuste em **Minha conta → Leitor**.
- A **quantidade** vale para a unidade lida: ler a caixa `CX12` com quantidade 1 movimenta 12 unidades.
- Etiquetas GS1 (com lote, validade e série) preenchem esses campos sozinhas.
- Cada leitura é registrada uma vez, mesmo que a rede falhe e o coletor tente de novo. Ler o mesmo código duas vezes conta duas unidades (de propósito).
- A tela mostra **Confirmado** (verde, ícone ✓) ou **Não confirmado** (vermelho, ícone ✗) com o motivo. Só o que aparece como confirmado foi gravado. Com "Aviso sonoro" ligado, um bipe curto = ok, longo = recusado.
- **Código ambíguo**: se o mesmo código pertence a mais de um produto, o WMS pede para escolher o que está na sua mão. Ele nunca escolhe sozinho.

## Recebimento

1. **Recebimento** → abra o documento (ou o supervisor cria a previsão manual).
2. Leia cada item. Escolha o resultado: *Aceito*, *Avariado* (vai para quarentena) ou *Recusado na porta* (não entra no estoque).
3. Lote e validade são obrigatórios para produtos com esse controle; série é uma por unidade.
4. **Confirmar recebimento conferido**. Só então o estoque entra (em `RECEB` ou em quarentena).
   - Se chegou **mais** do que o previsto, fica "Aguardando supervisor".
   - Se chegou **menos**, fica "Recebido parcialmente" e a falta continua pendente.

**Supervisor**: aprove a sobra (ou remova a leitura), encerre com falta (vira ocorrência) ou cancele (só sem estoque lançado).

## Armazenagem e reabastecimento

**Armazenagem** → **Executar** → leia na ordem: endereço de origem, produto, endereço de destino. O WMS sugere o destino (mesmo produto/lote, zona preferida, capacidade), mas você pode guardar em outro endereço válido. Endereço bloqueado, em inventário ou sem capacidade é recusado.

**Gerar reabastecimento** cria tarefas do pulmão para os endereços de picking abaixo do mínimo.

## Separação

1. **Separação** → **Pegar** a tarefa (uma pessoa por tarefa).
2. A tela mostra endereço, SKU, descrição, quantidade e lote. Leia o **endereço**, depois o **produto**.
3. Se a quantidade não está lá: **Registrar falta**. Não confirme o que não pegou. O supervisor decide a realocação.
4. **Encerrar tarefa** quando não houver pendências.
5. Pedido cancelado ou alterado no ERP bloqueia a tarefa na hora. O que já foi separado volta ao estoque por uma tarefa de **retorno** em Armazenagem.

## Conferência e embalagem

1. **Conferência** → escolha o pedido → **Iniciar conferência** → **Abrir volume**.
2. Leia cada item para dentro do volume. Produto que não é do pedido, ou quantidade acima do separado, é recusado.
3. **Fechar volume** (peso opcional, informado por você) e **Imprimir etiqueta**. Reimpressão pede motivo e fica registrada; não cria remessa nem baixa.
4. **Concluir conferência** só passa se pedido, separado e embalado baterem.

## Expedição

1. **Expedição** → **Criar remessa** (transportadora e doca) → **Incluir** os pedidos embalados.
2. Leia a etiqueta de **todos** os volumes no carregamento.
3. **Confirmar despacho**: é a confirmação da saída física. Não acontece ao imprimir etiqueta.
   - Recusado se faltar volume, se o pedido foi cancelado/alterado, ou se a nota não estiver autorizada (quando o armazém exige).
   - A mensagem diz como o ERP fica sabendo: "baixa feita pelo ERP", "pendente de envio" ou "política não definida".

## Inventário (supervisor cria; operadores contam)

1. Crie o inventário (endereços, tolerância e rodadas). **Iniciar** bloqueia os endereços para movimento e reserva. Endereço com reserva ou estoque bloqueado não entra.
2. Operadores contam **às cegas**: informam endereço e leem os produtos. A tela não mostra o saldo esperado.
3. **Encerrar rodada**: fora da tolerância, os endereços voltam para recontagem; senão, geram ajustes.
4. Um supervisor **diferente** de quem solicitou e de quem contou aprova (com MFA). Aprovar de novo não aplica a diferença outra vez.
5. **Carga inicial**: é um inventário do tipo "Carga inicial"; nada entra no saldo sem aprovação.

## Devoluções

Abra a devolução (vinculada ao pedido expedido quando possível), leia os itens (entram em quarentena em `DEVOL`) e registre a **decisão de qualidade**: reintegrar (escolha o endereço), reparo, descarte ou devolução ao fornecedor. Estorno fiscal é feito no ERP.

## Supervisor: ocorrências e correções

- **Visão geral** lista ocorrências abertas (faltas, sobras, avarias, divergência com o ERP, pedido alterado).
- **Pedidos → detalhe**: reservar, reconciliar revisão, realocar falta, cancelar (pede motivo).
- **Movimentações → Reverter**: corrige transferência/armazenagem/condição com movimento inverso vinculado (o original nunca é editado).
- **Estoque → Bloquear/liberar** muda a condição do estoque com motivo.
- Tudo fica em **Auditoria**.
