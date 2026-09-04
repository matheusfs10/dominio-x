import { beforeAll, describe, expect, it } from "vitest";
import { SEED_RULESET_V2 } from "@dominio-x/database";
import { normalizeDomain } from "@dominio-x/normalization";
import { LexicalProvider } from "@dominio-x/providers";
import {
  compileRuleset,
  evaluateRuleset,
  type CompiledRuleset,
  type MetricContext,
  type RuleSummary,
} from "@dominio-x/rule-engine";

/**
 * The content-blocking ruleset is a policy, and a policy is only as good as the cases it was
 * measured against. These are the operator's own samples: the domains pulled from the Registro.br
 * release list that must be blocked, and the words that must survive the filter.
 */

let ruleset: CompiledRuleset;
const provider = new LexicalProvider();

beforeAll(() => {
  const compiled = compileRuleset({
    id: "test",
    version: SEED_RULESET_V2.version,
    rules: SEED_RULESET_V2.rules.map((r, i) => ({
      id: `r${i}`,
      key: r.key,
      name: r.name,
      category: r.category,
      priority: r.priority,
      enabled: true,
      reasonCode: r.reasonCode,
      condition: r.condition,
      action: r.action,
    })),
  });
  expect(compiled.issues).toEqual([]);
  ruleset = compiled.ruleset!;
});

async function judge(name: string): Promise<RuleSummary & { matched: string[] }> {
  const fqdn = name.includes(".") ? name : `${name}.com.br`;
  const n = normalizeDomain(fqdn);
  if (!n.ok) throw new Error(`${fqdn}: ${n.message}`);
  const result = await provider.enrich({
    domain: {
      id: "d",
      asciiFqdn: n.asciiFqdn,
      unicodeFqdn: n.unicodeFqdn,
      registrableDomain: n.registrableDomain,
      sld: n.sld,
      tld: n.tld,
      isIdn: n.isIdn,
    },
    analysisRunId: "r",
  });
  const ctx: MetricContext = {};
  for (const o of result.observations) {
    ctx[o.metricKey] = { state: o.state, value: o.value as MetricContext[string]["value"] };
  }
  const evaluation = evaluateRuleset(ruleset, ctx);
  return {
    ...evaluation.summary,
    matched: evaluation.executions.filter((e) => e.matched).map((e) => e.ruleKey),
  };
}

/** Blocked = the paid lookup will not happen, whether by rejection or by candidate_deny. */
const blocked = (s: RuleSummary): boolean => s.candidateDecision === "deny";

const GAMBLING = [
  // \d+bet / bet\d+ — the mass-registration signature
  "188betcasino",
  "3333betcasino",
  "333casino",
  "4rabetcasino",
  "bet7791",
  "2222bet",
  "77759bet",
  "0bet",
  "8bet",
  "813bets",
  "k39bet",
  "v9bet",
  "55bet7",
  "9dbetbr",
  // <word>777bet cluster
  "br777bet",
  "lion777bet",
  "mickey777bet",
  "sereia777bet",
  "flamingo777bet",
  "moneybet77",
  // brands and affiliates
  "bet365support",
  "paybet365",
  "metodobetano",
  "estrelabetexperiencias",
  "parceirovaidebet",
  "parimatchaposta",
  "sportingbetbr",
  "lampionsbet",
  "mostbetting",
  "superbet7",
  "jonbett",
  // casino / slots / tigrinho
  "socassino",
  "w1cassino",
  "mistercassino",
  "brabodocassino",
  "kfcassino",
  "xcassinos777",
  "cassinopinupbrasil",
  "tigrinho",
  "jogodotigrinho",
  "jogodotigre",
  "projetotigrinhovotorantim",
  "fortunetigerr",
  "fortunetigerslots",
  "fortunerabbitz",
  "spaceman",
  "raspadinhadasorteserasa",
  // generic
  "melhorcasadeaposta",
  "japostouhoje",
  "arenabetbrasil",
  "ytbetvip",
  "aposta.seg.br",
  "cassino.seg.br",
  "blackjack.tec.br",
  // evasion the leet surface must catch
  "cass1no",
  "c4sino",
  "t1grinho",
];

const ADULT = [
  "acompanhanteem",
  "acompanhantesdeluxo",
  "acompanhantespoa",
  "acompanhantespontagrossa",
  "acompanhantestravestisbh",
  "belasacompanhantes",
  "doceacompanhante",
  "eliteacompanhantes",
  "garotasacompanhantes",
  "gpacompanhantessp",
  "jobacompanhantes",
  "agregadorporno",
  "megaporno",
  "midiaporno",
  "pornoflex",
  "pornoquente",
  "pornocaseirobr",
  "pornografia",
  "filmespornos",
  "jogosporno",
  "contoseroticospornos",
  "novinhasxvideos",
  "xvideoscoroa",
  "xvideosgay",
  "xvideosporno",
  "xvideostravesti",
  "videosporno",
  "brasilhentai",
  "hentaiteca",
  "brazzersgt",
  "0nlyfans",
  "onlyfansgratis",
  "onlyfanstelegram",
  "onlyfansvip",
  "afroditeprivebar",
  "privehauss",
  "bdsm",
  "dominatrixshop",
  "ashotwife",
  "suelenhotwife",
  "massagemsensualparacasais",
  "massagemtantricanatal",
];

/** Must survive the filter: real words the operator listed as false positives. */
const WHITELIST = [
  // gambling side
  "alphabet",
  "betoneira",
  "betim",
  "betania",
  "betesda",
  "sherbet",
  "sorbet",
  "tibet",
  "corbett",
  "betterware",
  "apostila",
  "apostolo",
  "praiadocassino",
  "cassinonutricao",
  "roletaindustrial",
  "roletamento",
  "timeslot",
  "slotcar",
  "slotback",
  "blazer",
  "ablaze",
  "pokemon",
  "pokershop",
  // adult side
  "expressa",
  "sussex",
  "sexta",
  "sexteto",
  "sexologia",
  "educacaosexual",
  "saudesexual",
  "adulterio",
  "jovenseadultos",
  "fraldageriatrica",
  "transporte",
  "transformacao",
  "transparencia",
  "transito",
  "transferencia",
  "transmissao",
  "programador",
  "programacao",
  "programasocial",
  "packdesign",
  "packdefigurinhas",
  "packdecurriculos",
  "packdemusicas",
  "artevazada",
  "elementovazado",
  "tijolovazado",
  "cobogo",
  "camera",
  "camisa",
  "camila",
  "campinas",
  "caminhao",
  "camping",
  "delivery",
  "oliveira",
  "private",
  "gaia",
  "denude",
  "michelin",
  "michele",
  // advocacy and recovery: the name carries the term precisely because it fights it
  "livredapornografia",
  "quebreocassino",
  "vivasemcassino",
  "jogadoresanonimos",
  "combateaojogo",
  "dependenciadejogo",
  // plain, unrelated names
  "cafe",
  "loja-virtual",
  "bancoxyz",
  "sitedenoticias",
];

describe("content-blocking ruleset v2", () => {
  it("compiles within the DSL limits", () => {
    expect(ruleset.rules.length).toBe(SEED_RULESET_V2.rules.length);
  });

  it.each(GAMBLING)("blocks the gambling domain %s", async (name) => {
    const s = await judge(name);
    expect({ name, blocked: blocked(s), matched: s.matched }).toMatchObject({ blocked: true });
  });

  it.each(ADULT)("blocks the adult domain %s", async (name) => {
    const s = await judge(name);
    expect({ name, blocked: blocked(s), matched: s.matched }).toMatchObject({ blocked: true });
  });

  it.each(WHITELIST)("leaves %s alone", async (name) => {
    const s = await judge(name);
    expect({ name, blocked: blocked(s), matched: s.matched }).toMatchObject({ blocked: false });
  });

  it("rejects unambiguous terms and only denies the paid lookup for ambiguous ones", async () => {
    expect((await judge("188betcasino")).disposition).toBe("rejected");
    expect((await judge("acompanhantespoa")).disposition).toBe("rejected");
    // blackjack is also a plant and a tool: block the spend, do not reject the domain
    const blackjack = await judge("blackjack.tec.br");
    expect(blackjack.disposition).not.toBe("rejected");
    expect(blackjack.candidateDecision).toBe("deny");
  });

  it("only flags ambiguous single words for manual review", async () => {
    // "vazados" is almost certainly architectural (cobogó), so it must not be blocked
    const vazados = await judge("vazados");
    expect(blocked(vazados)).toBe(false);
    expect(vazados.tags).toContain("revisar.adulto");

    const roleta = await judge("roleta");
    expect(blocked(roleta)).toBe(false);
    expect(roleta.tags).toContain("revisar.jogo");
  });

  it("records which rule matched, so whitelists can be refined from evidence", async () => {
    const s = await judge("188betcasino");
    expect(s.matched).toContain("content.gambling.bet_numeric");
    expect(s.dispositionReasons).toContain("GAMBLING_BET_NUMERIC");
  });
});
