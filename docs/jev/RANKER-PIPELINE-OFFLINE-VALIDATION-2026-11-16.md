# Validação offline do pipeline real de ranking

Data: 16/11/2026. Escopo: cópia isolada do OSS, sem alterar originais, modelo padrão, configuração global ou evidência do lote pago anterior. Nenhuma nova chamada paga foi realizada.

## O que foi executado

Novo arquivo: `tests/context-ranker/pipeline-offline.test.ts`.

Onze testes chamam a função pública `rankContext` com diretórios sintéticos novos em cada teste. As etapas A, B, C e D, o cache, a leitura dos arquivos, os filtros e a telemetria são código real. Somente a fronteira `SafeJevClient` é simulada; isso não testa autenticação, SDK, HTTP, servidor remoto ou inteligência do modelo. `fetch` está bloqueado e cada teste verifica que não foi chamado. Os diretórios temporários são removidos apenas após validar raiz e prefixo de teste.

Cobertura:

1. Implementação, utilitário-fonte dependente e teste relacionado entram no resultado quando os sinais semânticos controlados os sustentam. `.env`, chave sintética, vendor e build não chegam ao cliente.
2. O contrato real da etapa C contém `task` e um `file` com path, extensão, tamanho, símbolos e snippet de até 1.200 caracteres, com perguntas Noul, Score e Choice.
3. `useJev:false` funciona sem chamadas semânticas e identifica fallback determinístico.
4. Resposta controlada de timeout produz fallback explícito e preserva candidatos heurísticos relevantes.
5. Score semântico fora do intervalo é rejeitado e gera fallback.
6. Repetição com modelo fixo usa cache, sem novas chamadas.
7. Tarefa e identidade do modelo separam caches; trocar identidade em teste não muda configuração real.
8. Alterar snippet invalida o item correspondente.
9. Noul abaixo de 0,5 pode ser mantido pelo score composto real quando os demais sinais o sustentam.
10. Threshold e top são aplicados ao score final.
11. O limite da shortlist B restringe quais arquivos a etapa semântica consegue examinar.

## Por que o lote anterior não mede este pipeline

O lote anterior comparou diretamente 1.13 e 1.14, com todos os candidatos de cada caso num mesmo estado e uma pergunta Noul por candidato. A seleção era Noul >= 0,5. Não houve etapas A/B/D, cache, pesos de função arquitetural ou Score de relevância. Essas respostas não podem ser reaproveitadas como se respondessem às perguntas reais da etapa C.

No pipeline real:

- A exclui arquivos por padrões, ignorados, segredos, tamanho e tipo.
- B usa caminho, palavras e símbolos para produzir uma shortlist, padrão 15.
- C avalia cada candidato em uma chamada com três perguntas: relevância Noul, Score de 0 a 4 e função arquitetural Choice.
- D calcula 30% de heurística + 70% de sinal composto. O composto combina 45% Noul, 40% Score normalizado e 15% peso da função, multiplicados por um fator de confiança mínimo de 0,4. Os padrões finais são threshold 0,15 e top 10.

Portanto, os 2/36 conjuntos exatos no lote direto não demonstram defeito do ranker instalado. O novo teste reproduz explicitamente um caso em que Noul baixo ainda é selecionado por D. Isso comprova funcionamento da fórmula, não que essa seleção seja correta em tarefas reais.

## Limites constatados, sem alterar política

- O sistema não constrói um grafo completo de imports. Um utilitário pode entrar por heurística/semântica; não existe garantia de que todas as dependências serão recuperadas.
- Um candidato ausente da shortlist B não é recuperável pela etapa C. É necessário medir recall da shortlist separadamente do ranking final.
- Tokenização heurística remove caracteres não ASCII e não traduz uma tarefa portuguesa para nomes ingleses. A decomposição camelCase não corresponde integralmente ao comentário atual. São limitações preexistentes, não houve reescrita do tokenizer.
- Diretórios inacessíveis, profundidade e varredura parcial continuam limites relevantes. Os 15 testes de orçamento anteriores foram preservados.
- Respostas simuladas são fixtures de contrato, não evidência de acerto de 1.13 ou 1.14, nem comparação de qualidade/custo/latência dos modelos.
- Este teste não adiciona interceptação automática em chats ou Dot. O piloto local permanece consultivo e explicitamente invocado.

## Próximo critério de avaliação, sem novas APIs

Manter 1.13 fixado. Preparar conjunto retido com pelo menos 20 candidatos por tarefa, incluindo implementação, testes necessários, dependências-fonte indiretas, documentação útil, distratores lexicalmente parecidos, build/vendor e segredos sintéticos. Separar contexto necessário para entender uma mudança de arquivos que precisam ser editados.

Congelar rótulos antes de qualquer resposta, avaliando: recall de A/B, Precision/Recall@K com K menor que o pool, recall do conjunto após threshold, exposição proibida, estabilidade de cache e fallback. Revisar independentemente perguntas, limiar e rótulos, sem ajustar tudo ao mesmo corpus. Usar uma parte de calibração e uma parte retida; não transformar repetição ou tradução do mesmo cenário em amostra independente.

Uma futura avaliação live precisaria usar exatamente o contrato C e medir o pipeline completo. Não está autorizada por este trabalho offline e não foi executada.

## Resultado

Nenhum bug concreto que exija alteração de source foi identificado pelos 11 novos testes. Nenhuma fórmula ou threshold foi calibrado para melhorar artificialmente o resultado anterior. Os artefatos de avaliação pagos anteriores permanecem inalterados.

Precisão de cobertura após revisão independente: o mock substitui a classe SafeJevClient inteira, não apenas o transporte HTTP. O teste de TIMEOUT injeta uma resposta de erro controlada e não verifica cancelamento por relógio/deadline. A exclusão de arquivos secretos é verificada individualmente antes da fronteira semântica; este arquivo de testes não verifica redação de padrões secretos embutidos em arquivos permitidos. O cache quente verifica explicitamente zero tokens novos enviados e recebidos. Não há alegação de cobertura dessas funcionalidades além das asserções executadas.

