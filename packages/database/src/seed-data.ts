import { METRICS, PROVIDER_KEYS, SOURCE_KEYS } from "@dominio-x/contracts";

/**
 * Canonical seed definitions. These are data, not behavior: the rule DSL and score weights
 * are interpreted by @dominio-x/rule-engine and @dominio-x/scoring.
 */

export const SEED_SOURCES = [
  {
    key: SOURCE_KEYS.REGISTRO_BR_RELEASE,
    name: "Registro.br — lista do processo de liberação",
    type: "registry_release" as const,
    configJson: {
      url: "https://registro.br/dominio/lista-processo-liberacao.txt",
      infoUrl: "https://registro.br/dominio/processo-de-liberacao",
    },
  },
  { key: SOURCE_KEYS.MANUAL, name: "Manual submission", type: "manual" as const, configJson: {} },
  { key: SOURCE_KEYS.CSV_IMPORT, name: "CSV import", type: "csv_import" as const, configJson: {} },
];

export const SEED_PROVIDERS = [
  {
    key: PROVIDER_KEYS.LEXICAL,
    name: "Local lexical analysis",
    enabled: true,
    paid: false,
    capabilities: ["lexical"],
    rateLimitRps: 1000,
    concurrencyLimit: 100,
    timeoutMs: 1000,
    defaultTtlHours: 0,
    retentionPolicy: "internal",
  },
  {
    key: PROVIDER_KEYS.DNS,
    name: "DNS resolver",
    enabled: true,
    paid: false,
    capabilities: ["dns"],
    rateLimitRps: 50,
    concurrencyLimit: 20,
    timeoutMs: 5000,
    defaultTtlHours: 24,
    retentionPolicy: "public_source",
  },
  {
    key: PROVIDER_KEYS.RDAP,
    name: "RDAP (registration data)",
    enabled: false,
    paid: false,
    capabilities: ["rdap"],
    rateLimitRps: 2,
    concurrencyLimit: 2,
    timeoutMs: 8000,
    defaultTtlHours: 24 * 7,
    retentionPolicy: "public_source",
  },
  {
    key: PROVIDER_KEYS.CRAWLER,
    name: "Isolated HTTP crawler",
    enabled: true,
    paid: false,
    capabilities: ["http"],
    rateLimitRps: 20,
    concurrencyLimit: 10,
    timeoutMs: 12_000,
    defaultTtlHours: 72,
    retentionPolicy: "public_source",
  },
  {
    key: PROVIDER_KEYS.SEMRUSH,
    name: "Semrush",
    enabled: false,
    paid: true,
    capabilities: ["seo", "backlinks", "traffic", "keywords"],
    rateLimitRps: 8,
    concurrencyLimit: 8,
    timeoutMs: 15_000,
    defaultTtlHours: 24 * 30,
    retentionPolicy: "provider_restricted",
    configJson: {
      integrationMode: "standby",
      note: "Integration mode (official API vs alternative) not yet decided.",
    },
  },
  {
    key: PROVIDER_KEYS.DATAFORSEO,
    name: "DataForSEO (tráfego estimado de busca)",
    enabled: true,
    paid: true,
    capabilities: ["traffic"],
    rateLimitRps: 2,
    concurrencyLimit: 2,
    timeoutMs: 20_000,
    defaultTtlHours: 24 * 30,
    retentionPolicy: "provider_restricted",
    configJson: {
      endpoint: "dataforseo_labs.historical_bulk_traffic_estimation",
      note: "Runs only behind the free traffic gate (Settings > Gate de tráfego). Cost is read from the provider response.",
    },
  },
];

export const SEED_SCORE_MODEL_V1 = {
  name: "Transparent weighted v1",
  version: 1,
  weightsJson: {
    name: 0.25,
    brand: 0.2,
    seo: 0.25,
    link: 0.1,
    history: 0.1,
    commercial: 0.1,
  },
  configJson: {
    riskPenaltyFactor: 0.35,
    expectedDimensions: ["name", "brand", "seo", "link", "history", "commercial", "risk"],
  },
};

/**
 * Same weights as v1, but with the paid traffic estimates feeding the SEO dimension. Seeded as a
 * DRAFT: activating it changes how every future run is scored, which is the operator's call.
 */
export const SEED_SCORE_MODEL_V2 = {
  name: "Transparent weighted v2 (com tráfego estimado)",
  version: 2,
  weightsJson: SEED_SCORE_MODEL_V1.weightsJson,
  configJson: { ...SEED_SCORE_MODEL_V1.configJson, useTrafficSignals: true },
};

export const SEED_RULESET_V1 = {
  name: "Conservative defaults v1",
  version: 1,
  description:
    "Minimal system rules: reject malformed/blacklisted, penalize noisy names, flag punycode and crawler security failures for review.",
  rules: [
    {
      key: "blacklist.match",
      name: "Analyst blacklist match",
      description: "Domain matches an entry in the internal blacklist.",
      category: "blacklist",
      priority: 10,
      reasonCode: "BLACKLISTED",
      condition: { metric: "internal.blacklisted", op: "eq", value: true },
      action: { type: "reject" },
    },
    {
      key: "lexical.excessive_digits",
      name: "Excessive digits",
      description: "More than 4 digits in the name is usually low value (penalty, not reject).",
      category: "lexical",
      priority: 100,
      reasonCode: "EXCESSIVE_DIGITS",
      condition: { metric: METRICS.LEXICAL_DIGIT_COUNT, op: "gt", value: 4 },
      action: { type: "score_adjustment", dimension: "name", delta: -15 },
    },
    {
      key: "lexical.excessive_hyphens",
      name: "Excessive hyphens",
      description: "More than 2 hyphens is a penalty.",
      category: "lexical",
      priority: 100,
      reasonCode: "EXCESSIVE_HYPHENS",
      condition: { metric: METRICS.LEXICAL_HYPHEN_COUNT, op: "gt", value: 2 },
      action: { type: "score_adjustment", dimension: "name", delta: -10 },
    },
    {
      key: "lexical.very_long_sld",
      name: "Very long SLD",
      description: "SLD longer than 24 characters is a penalty.",
      category: "lexical",
      priority: 100,
      reasonCode: "VERY_LONG_SLD",
      condition: { metric: METRICS.LEXICAL_SLD_LENGTH, op: "gt", value: 24 },
      action: { type: "score_adjustment", dimension: "name", delta: -10 },
    },
    {
      key: "lexical.random_looking",
      name: "Random-looking name",
      description:
        "High randomness heuristic → warn and penalize; hard reject only at extreme values.",
      category: "lexical",
      priority: 110,
      reasonCode: "RANDOM_LOOKING",
      condition: { metric: METRICS.LEXICAL_RANDOMNESS_SCORE, op: "gte", value: 0.75 },
      action: { type: "score_adjustment", dimension: "name", delta: -20 },
    },
    {
      key: "lexical.punycode_review",
      name: "Punycode / IDN review",
      description: "IDN domains are flagged for analyst review, never auto-rejected.",
      category: "lexical",
      priority: 120,
      reasonCode: "PUNYCODE_REVIEW",
      condition: { metric: METRICS.LEXICAL_IS_PUNYCODE, op: "eq", value: true },
      action: { type: "warn", disposition: "needs_review" },
    },
    {
      key: "security.crawler_blocked",
      name: "Crawler security block",
      description:
        "The crawler refused the target (SSRF / unsafe destination). Quarantine for review.",
      category: "security",
      priority: 50,
      reasonCode: "CRAWLER_SECURITY_BLOCK",
      condition: { metric: METRICS.HTTP_SECURITY_BLOCKED, op: "eq", value: true },
      action: { type: "quarantine" },
    },
    {
      key: "gate.short_clean_name",
      name: "Short clean name → paid candidate",
      description: "Short names with no digits are always worth deep analysis.",
      category: "lexical",
      priority: 200,
      reasonCode: "SHORT_CLEAN_NAME",
      condition: {
        all: [
          { metric: METRICS.LEXICAL_SLD_LENGTH, op: "lte", value: 8 },
          { metric: METRICS.LEXICAL_DIGIT_COUNT, op: "eq", value: 0 },
          { metric: METRICS.LEXICAL_HYPHEN_COUNT, op: "eq", value: 0 },
        ],
      },
      action: { type: "candidate_allow" },
    },
  ],
};

/**
 * Content-category blocks (gambling and adult), from the operator's specification.
 *
 * Matching contract: every pattern runs against a pre-normalized surface emitted by the lexical
 * provider — lower-cased, accent-stripped, separators removed. `sld_leet` additionally maps
 * 0134 57 onto oiea st, which catches evasion ("cass1no") for free; digit-bearing patterns use
 * `sld_ascii` instead, because leet mapping would eat the digits. False-positive lists are
 * expressed as `not` conditions on `sld_ascii`, since RE2 has no lookahead.
 *
 * Confidence maps onto the action:
 *   reject         — unambiguous term or known brand; also denies the paid lookup, because a
 *                    rejected disposition sets `candidateDecision = "deny"`
 *   candidate_deny — blocks the paid lookup and stays visible for review; disposition untouched
 *   tag            — ambiguous single word: flags for manual review, blocks nothing
 *
 * Every match is recorded in `rule_executions` with the rule key and the matched leaves, which
 * is the audit trail for refining the whitelists.
 */
export const CONTENT_BLOCK_RULES = [
  {
    key: "content.gambling.bet_numeric",
    name: "Aposta: bet colado a numero",
    description:
      "Assinatura numero 1 de registro em massa nas listas de liberacao: 188bet, bet365, 777bet.",
    category: "reputation",
    priority: 20,
    reasonCode: "GAMBLING_BET_NUMERIC",
    condition: {
      metric: METRICS.LEXICAL_SLD_ASCII,
      op: "matches_safe_regex",
      value: "[0-9]bet|bet[0-9]",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.bet_affix",
    name: "Aposta: bet com afixo de marca",
    description: "Prefixos e sufixos tipicos de casa de aposta colados a bet.",
    category: "reputation",
    priority: 21,
    reasonCode: "GAMBLING_BET_AFFIX",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value:
            "betcasino|betcassino|betsport|betsbr|betbr|brbet|betapp|betpix|betvip|betfast|betgame|betmax|betcopa|betao",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value:
              "apostila|apostol|alphabet|betoneira|betim|betania|betesda|sherbet|sorbet|tibet|corbett|betterware",
          },
        },
      ],
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.casino",
    name: "Cassino",
    description: "Cassino em PT, EN e grafias de evasao. Superficie leet pega cass1no e c4sino.",
    category: "reputation",
    priority: 22,
    reasonCode: "GAMBLING_CASINO",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value: "cassino|casino|cazino|kassino|kazino|tragamoeda|cacaniquel",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value:
              "praiadocassino|cassinors|bairrocassino|ferragemcassino|cassinonutricao|vivasemcassino|quebreocassino|semcassino|combateaojogo|jogadoresanonimos|dependenciadejogo",
          },
        },
      ],
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.apostas",
    name: "Apostas e palpites",
    description:
      "Nucleo do setor. apost[aoe] cobre aposta, aposto, aposte e apostou (japostouhoje) sem casar apostila nem apostolo.",
    category: "reputation",
    priority: 23,
    reasonCode: "GAMBLING_APOSTAS",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value:
            "apost[aoe]|palpite|prognostico|tipster|bilhetepremiado|batergreen|entradaconfirmada",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value:
              "apostila|apostol|alphabet|betoneira|betim|betania|betesda|sherbet|sorbet|tibet|corbett|betterware",
          },
        },
      ],
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.crash_games",
    name: "Jogos crash e caca-niquel de marca",
    description: "Tigrinho, Fortune*, Aviator e afins: nomes de jogos, sem ambiguidade.",
    category: "reputation",
    priority: 24,
    reasonCode: "GAMBLING_CRASH_GAMES",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "tigrinho|jogodotigre|fortunetiger|fortuneox|fortunerabbit|fortunemouse|fortunedragon|aviaozinho|spaceman|rocketman|plinko|sweetbonanza|gatesofolympus|gateofolympus|bigbass",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.bicho_rifa",
    name: "Jogo do bicho e raspadinha",
    description: "Loteria paralela e raspadinha online.",
    category: "reputation",
    priority: 25,
    reasonCode: "GAMBLING_BICHO_RIFA",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "jogodobicho|deunoposte|resultadodobicho|bancadebicho|raspadinha|raspaeganha|raspouganhou",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.jargon",
    name: "Jargao de cassino online",
    description: "Giros gratis, jackpot, provedores de jogo.",
    category: "reputation",
    priority: 26,
    reasonCode: "GAMBLING_JARGON",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "girosgratis|rodadasgratis|freespins|jackpot|rtpalto|pragmaticplay|pgsoft|hacksaw|spribe|dragontiger",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.brands_global",
    name: "Marcas de aposta internacionais",
    description: "Lista de bloqueio direto de marcas globais.",
    category: "reputation",
    priority: 27,
    reasonCode: "GAMBLING_BRAND",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "bet365|betano|betfair|sportingbet|betnacional|betsson|parimatch|1xbet|melbet|22bet|4rabet|mostbet|betwinner|1win|20bet|betmgm|lottoland",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.brands_br",
    name: "Marcas de aposta brasileiras",
    description: "Lista de bloqueio direto de marcas do mercado brasileiro.",
    category: "reputation",
    priority: 28,
    reasonCode: "GAMBLING_BRAND",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "pixbet|vaidebet|estrelabet|superbet|esportivabet|betpix365|br4bet|bravobet|hiperbet|luvabet|lampionsbet|tivobet|apostaganha|reidopitaco|betboom|f12bet",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.brands_more",
    name: "Marcas de aposta e cassino (complemento)",
    description: "Segunda metade da lista de marcas.",
    category: "reputation",
    priority: 29,
    reasonCode: "GAMBLING_BRAND",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "novibet|betwarrior|mcgames|jonbet|brazino|cassinopix|pagbet|h2bet|betgorillas|betdasorte|apostatudo|verabet|papigames|onabet|aajogo|betpp|bacanaplay|kto",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.brands_ambiguous",
    name: "Marcas de aposta com risco de falso-positivo",
    description: "Blaze e Stake sao palavras comuns; a whitelist remove blazer, ablaze e mistake.",
    category: "reputation",
    priority: 30,
    reasonCode: "GAMBLING_BRAND",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value: "blaze|stake|brazino777",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value: "blazer|ablaze|mistake|stakeholder",
          },
        },
      ],
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.easy_money",
    name: "Metodo e robo de aposta",
    description: "Promessa de ganho facil atrelada a jogo.",
    category: "reputation",
    priority: 31,
    reasonCode: "GAMBLING_EASY_MONEY",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "ganheapostando|lucrecomaposta|metodoroleta|metodotigrinho|robodeaposta|robotigrinho|sinaltigrinho|sinaisdeaposta|hacktigrinho|plataformadeaposta|saquenaposta",
    },
    action: { type: "reject" },
  },
  {
    key: "content.gambling.slots_context",
    name: "Slots com contexto",
    description:
      "slot so bloqueia com contexto: slotscasino, 7slots. Whitelist tira timeslot e slotcar.",
    category: "reputation",
    priority: 40,
    reasonCode: "GAMBLING_SLOTS_CONTEXT",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_ASCII,
          op: "matches_safe_regex",
          value: "slotscasino|slotsbrasil|slotsonline|slotsbet|slotgame|[0-9]slots?",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value: "timeslot|slotcar|slotback|camslot",
          },
        },
      ],
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.gambling.table_games",
    name: "Jogos de mesa com contexto",
    description: "Roleta e poker so com contexto; blackjack e baccarat sao inequivocos.",
    category: "reputation",
    priority: 41,
    reasonCode: "GAMBLING_TABLE_GAMES",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value:
            "roletaonline|roletabrasil|roletabet|roulette|blackjack|baccarat|pokeronline|texasholdem|dominoqq",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value: "roletaindustrial|roletamento|pokershop",
          },
        },
      ],
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.gambling.mines_context",
    name: "Mines com contexto de jogo",
    description: "mines sozinho e falso-positivo (mineracao); exige contexto de jogo.",
    category: "reputation",
    priority: 42,
    reasonCode: "GAMBLING_MINES_CONTEXT",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value: "minesjogo|minesgame|minesbet|jogodemines|minesaposta",
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.gambling.rifa_context",
    name: "Rifa e bolao com contexto de aposta",
    description: "Rifa beneficente e legitima; exige contexto comercial.",
    category: "reputation",
    priority: 43,
    reasonCode: "GAMBLING_RIFA_CONTEXT",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value: "rifaonline|rifapremiada|rifadosorteio|rifavirtual|bolaodeaposta|bolaodacopa",
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.gambling.review",
    name: "Termo de jogo ambiguo (revisao manual)",
    description: "Palavra isolada e polissemica: sinaliza para revisao, nao bloqueia.",
    category: "reputation",
    priority: 60,
    reasonCode: "GAMBLING_REVIEW",
    condition: {
      metric: METRICS.LEXICAL_SLD_WORDS,
      op: "matches_safe_regex",
      value:
        "\\bslots?\\b|\\broleta\\b|\\bodds?\\b|\\bpoker\\b|\\bbolao\\b|\\brifas?\\b|\\bmines\\b|\\bdouble\\b",
    },
    action: { type: "tag", tag: "revisar.jogo" },
  },
  {
    key: "content.adult.porn",
    name: "Pornografia",
    description: "Termo nuclear. Superficie leet pega p0rn e pr0n.",
    category: "reputation",
    priority: 32,
    reasonCode: "ADULT_PORN",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value: "porno|pornogra|porn|hentai",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value: "livredaporno|combateaporno|contraaporno|semporno|vitimasdeporno|denunciaporno",
          },
        },
      ],
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.tubes",
    name: "Portais e marcas de tube adulto",
    description: "Marcas de tube e camming: bloqueio direto.",
    category: "reputation",
    priority: 33,
    reasonCode: "ADULT_TUBE_BRAND",
    condition: {
      metric: METRICS.LEXICAL_SLD_ASCII,
      op: "matches_safe_regex",
      value:
        "xvideos|xnxx|xhamster|redtube|youporn|pornhub|brazzers|bangbros|naughtyamerica|chaturbate|stripchat|bongacams|cam4|camsoda|myfreecams|livejasmin",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.escort",
    name: "Acompanhantes e prostituicao",
    description: "Termo dominante da categoria nas listas de liberacao brasileiras.",
    category: "reputation",
    priority: 34,
    reasonCode: "ADULT_ESCORT",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "acompanhante|garotadeprograma|garotasdeprograma|garotodeprograma|prostitut|fatalmodel|skokka|classificadosx|guiadoffy",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.massage",
    name: "Massagem como eufemismo",
    description: "Tantrica, sensual, erotica e nuru sao o eufemismo padrao do nicho.",
    category: "reputation",
    priority: 35,
    reasonCode: "ADULT_MASSAGE",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "massagemtantrica|massagemsensual|massagemerotica|massagistasensual|massagemnuru|massagemrelaxanteadulto",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.cam_onlyfans",
    name: "OnlyFans e camming",
    description: "Superficie leet resolve 0nlyfans e 0nlyf4ns sem regra extra.",
    category: "reputation",
    priority: 36,
    reasonCode: "ADULT_CAM",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value: "onlyfans|camgirl|sexcam|webcamsex|camsexo|camwhore|meuprivacy|privacyvip",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.leaks",
    name: "Packs, nudes e vazados",
    description: "So com contexto explicito: nude e vazado sozinhos sao falso-positivo.",
    category: "reputation",
    priority: 37,
    reasonCode: "ADULT_LEAKS",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "packdenudes|vendonudes|vendernudes|comprarnudes|nudesvazad|nudesdefamosas|caiunanet|fotosvazadas|famosasvazad|videosvazados",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.fetish",
    name: "Fetiche e BDSM",
    description: "Inclui ninfeta e lolita, que carregam conotacao de menoridade.",
    category: "reputation",
    priority: 38,
    reasonCode: "ADULT_FETISH",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "fetiche|fetish|bdsm|sadomaso|sadoemaso|dominatrix|hotwife|cuckold|ninfeta|incesto|lolita|findom",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.explicit_combo",
    name: "Combinacoes explicitas",
    description: "adulto e sexo so bloqueiam combinados com video, filme, conteudo ou site.",
    category: "reputation",
    priority: 39,
    reasonCode: "ADULT_EXPLICIT_COMBO",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "sexoexplicito|filmeadulto|filmesadulto|videoadulto|videosadulto|videosporno|filmesporno|conteudoadulto|jogosporno|agregadorporno|contoseroticos|siteadulto",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.lgbt_porn",
    name: "Pornografia LGBT (combinacao explicita)",
    description:
      "Nunca casa gay, trans ou travesti isolados: so combinados com termo pornografico.",
    category: "reputation",
    priority: 44,
    reasonCode: "ADULT_LGBT_PORN",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "pornogay|pornotrans|pornotravesti|sexogay|sexotrans|xvideosgay|xvideostravesti|xvideoscoroa|travestiacompanhante",
    },
    action: { type: "reject" },
  },
  {
    key: "content.adult.prive_context",
    name: "Prive com cidade ou qualificador",
    description: "prive sozinho e falso-positivo (private, prive de eventos); exige sufixo.",
    category: "reputation",
    priority: 45,
    reasonCode: "ADULT_PRIVE_CONTEXT",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value:
        "privebh|privesp|priverj|privepoa|privedf|priveluxo|priveclub|privebar|privehaus|privevip",
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.adult.swing_shop",
    name: "Swing e sex shop",
    description: "swing sozinho e falso-positivo (danca, swing trade); exige contexto.",
    category: "reputation",
    priority: 46,
    reasonCode: "ADULT_SWING_SHOP",
    condition: {
      metric: METRICS.LEXICAL_SLD_LEET,
      op: "matches_safe_regex",
      value: "casadeswing|casaldeswing|clubedeswing|sexshop|sexyshop",
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.adult.age_gate",
    name: "Marcacao de maioridade",
    description: "Digitos preservados: usa a superficie sem leet.",
    category: "reputation",
    priority: 47,
    reasonCode: "ADULT_AGE_GATE",
    condition: {
      metric: METRICS.LEXICAL_SLD_ASCII,
      op: "matches_safe_regex",
      value: "conteudo18|conteudos18|mais18|maioresde18|apenasmaiores|showaovivo18",
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.adult.xxx",
    name: "Marcador xxx",
    description: "Whitelist remove algarismo romano e tamanho de roupa.",
    category: "reputation",
    priority: 48,
    reasonCode: "ADULT_XXX",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_ASCII,
          op: "matches_safe_regex",
          value: "xxx",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value: "xxxi|maxxx|xxxl|xxxs",
          },
        },
      ],
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.adult.escort_ambiguous",
    name: "Miche e termos curtos do nicho",
    description: "Whitelist remove Michelin e Michele.",
    category: "reputation",
    priority: 49,
    reasonCode: "ADULT_ESCORT_AMBIGUOUS",
    condition: {
      all: [
        {
          metric: METRICS.LEXICAL_SLD_LEET,
          op: "matches_safe_regex",
          value: "miche|gpsp|gpacompanhante",
        },
        {
          not: {
            metric: METRICS.LEXICAL_SLD_ASCII,
            op: "matches_safe_regex",
            value: "michel|micheli|michele|michelin|micheline",
          },
        },
      ],
    },
    action: { type: "candidate_deny" },
  },
  {
    key: "content.adult.review",
    name: "Termo adulto ambiguo (revisao manual)",
    description: "Palavra isolada e polissemica: sinaliza para revisao, nao bloqueia.",
    category: "reputation",
    priority: 61,
    reasonCode: "ADULT_REVIEW",
    condition: {
      metric: METRICS.LEXICAL_SLD_WORDS,
      op: "matches_safe_regex",
      value:
        "\\bnudes?\\b|\\bpacks?\\b|\\bvazad[oa]s?\\b|\\bnovinhas?\\b|\\bprive\\b|\\bsexo\\b|\\badulto\\b|\\bteen\\b|\\bnude\\b",
    },
    action: { type: "tag", tag: "revisar.adulto" },
  },
];

/**
 * Identity of the content ruleset. Version numbers are handed out by `nextVersion()` whenever an
 * analyst creates or clones a ruleset through the UI, so a seeded ruleset must never be
 * recognised by its version: the seed would silently skip itself the moment an analyst happened
 * to occupy that number. This rule key is the marker instead.
 */
export const CONTENT_RULESET_MARKER_KEY = "content.gambling.bet_numeric";

/**
 * The conservative v1 rules plus the content-category blocks. Seeded as a DRAFT at whatever the
 * next free version is: activating it changes dispositions for every future run, so it is the
 * operator's call.
 */
export const SEED_CONTENT_RULESET = {
  name: "Bloqueio de jogo de azar e conteudo adulto",
  description:
    "Regras do v1 mais bloqueio automatico de dominios de jogo de azar/apostas/cassino e de conteudo adulto, com whitelist de falso-positivo por regra.",
  rules: [...SEED_RULESET_V1.rules, ...CONTENT_BLOCK_RULES],
};

export const SEED_SETTINGS = {
  /**
   * Free qualification policy for the paid traffic provider. Deliberately strict and with the
   * automatic lookup switched OFF: the operator turns it on after reviewing the thresholds.
   */
  traffic_gate: {
    enabled: false,
    maxDigits: 0,
    maxHyphens: 1,
    minSldLength: 3,
    maxSldLength: 20,
    maxRandomness: 0.6,
    allowPunycode: false,
    requireDictionaryToken: false,
    allowedTlds: ["com.br", "br"],
    requireDnsResolution: true,
    requireHttpReachable: false,
    allowedHttpStatuses: [],
    requireCandidateGate: true,
    reuseWithinDays: 30,
    maxLookupsPerBatch: 50,
    maxLookupsPerDay: 200,
    maxLookupsPerMonth: 2000,
    monthlyCostBudgetUsd: 20,
    minAccountBalanceUsd: 0,
  },
  candidate_gate: {
    enabled: true,
    maxSldLength: 20,
    maxDigits: 3,
    maxHyphens: 2,
    maxRandomness: 0.75,
    requireEvidence: false,
    maxDeepAnalysesPerBatch: 200,
  },
};

export const DEV_SAMPLE_DOMAINS = [
  "exemplo.com.br",
  "loja-virtual.com.br",
  "bancoxyz.com.br",
  "abc123456.com.br",
  "são-paulo-turismo.com.br",
  "cafe.com.br",
  "minha-super-loja-online-2024.com.br",
  "example.com",
];
