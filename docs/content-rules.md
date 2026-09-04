# Bloqueio por categoria de conteúdo (ruleset v2)

Regras que tiram domínios de jogo de azar/apostas/cassino e de conteúdo adulto do funil **antes**
de qualquer consulta paga. Vivem no ruleset versionado, não em configuração solta:
`CONTENT_BLOCK_RULES` / `SEED_RULESET_V2` em `packages/database/src/seed-data.ts`.

## Por que ruleset e não campos de formulário

Um ruleset é versionado, auditável regra a regra e reversível: ativar o v2 não apaga o v1, e cada
domínio bloqueado grava em `rule_executions` **qual regra casou e com que evidência**. É esse
registro que permite refinar a whitelist a partir de falso-positivo real, em vez de palpite.

## Superfícies de matching

O provedor lexical publica três formas normalizadas do rótulo registrável (minúsculas, sem acento):

| Métrica | Separadores | Dígitos | Para que serve |
| --- | --- | --- | --- |
| `lexical.sld_ascii` | removidos | preservados | padrões com dígito: `[0-9]bet`, `cam4`, `conteudo18` |
| `lexical.sld_leet` | removidos | mapeados `0134 57` → `oiea st` | evasão: `cass1no`, `0nlyfans`, `c4sino` |
| `lexical.sld_words` | viram espaço | preservados | âncoras `\b` para termo isolado e ambíguo |

Termos só-letras usam `sld_leet` de propósito: quando não há dígito ela é idêntica a `sld_ascii`,
então pega evasão de graça. Padrões com dígito **não podem** usá-la — o mapeamento leet transformaria
`188bet` em `i88bet` e destruiria a assinatura de squatting mais forte das listas de liberação.

## Confiança → ação

| Nível | Ação | Efeito |
| --- | --- | --- |
| ALTO | `reject` | disposição `rejected`; como `rejected` já implica `candidateDecision = "deny"`, a consulta paga também não acontece |
| MÉDIO | `candidate_deny` | bloqueia a consulta paga, disposição intacta — o domínio segue visível para revisão |
| BAIXO | `tag` | só sinaliza (`revisar.jogo`, `revisar.adulto`); não bloqueia nada |

## Whitelist de falso-positivo

RE2 **não tem lookahead**, então a whitelist não é `(?!...)` dentro do padrão: é uma condição
`{ not: ... }` sobre `lexical.sld_ascii`, avaliada junto com o padrão. Fica explícita na regra e
aparece na evidência.

Cada regex tem no máximo 200 caracteres (limite do DSL), o que forçou dividir a especificação em
32 regras temáticas — o que é melhor para auditar: o `reasonCode` diz exatamente o que barrou.

### Política sobre sites de combate

`livredapornografia`, `quebreocassino`, `vivasemcassino`, `jogadoresanonimos` carregam o termo
justamente porque o combatem. Estão na whitelist. É uma decisão de política, não um detalhe
técnico: se você preferir barrá-los também, remova as entradas `livredaporno|combateaporno|...` e
`quebreocassino|combateaojogo|...` das regras `content.adult.porn` e `content.gambling.casino`.

## Cobertura medida

`packages/domain-core/src/content-rules.test.ts` roda as regras contra as amostras reais da lista
do Registro.br: **63 domínios de jogo** e **42 de conteúdo adulto** que precisam ser bloqueados, e
**67 palavras** que precisam sobreviver (`alphabet`, `praiadocassino`, `timeslot`, `transporte`,
`packdesign`, `artevazada`, `michelin`, `educacaosexual`…). 176 casos no total.

Casos deliberadamente **não** bloqueados, só sinalizados: `vazados` (quase certamente cobogó),
`roleta`, `slots`, `poker`, `nudes`, `packs` isolados.

## Ativação

O v2 é semeado como **rascunho**. Ativá-lo muda a disposição de toda análise futura, então é decisão
do operador: Regras → ruleset v2 → Ativar (ou `POST /v1/rulesets/{id}/activate`). O v1 fica arquivado
e pode ser reativado.

## Atenção: domínios já analisados

As três superfícies de matching são métricas **novas**. Domínios analisados antes desta versão não
as têm, e uma regra sobre métrica ausente **não casa** — o comportamento falha de forma segura, sem
rejeitar ninguém por engano, mas também sem bloquear.

Para aplicar as regras aos domínios já ingeridos (os 158.227 da lista), é preciso **reanalisar**:
lote → "Analisar", ou reanálise forçada por domínio. A etapa de pré-checagem sempre recalcula o
provedor lexical, então uma reanálise basta — não é preciso limpar observação nenhuma.
