# Scoring (model v1 — "Transparent weighted")

Implemented in `packages/scoring/src/index.ts`. Every dimension is `0..100` or `null` (not
measurable from the available evidence). Nothing is fabricated: missing inputs produce `null`, a
`missing` explanation entry and a lower confidence.

## Dimensions

| Dimension   | Inputs                                                                                        | Notes                                                            |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| name        | SLD length, digits, hyphens, randomness heuristic, dictionary tokens, `.com.br`               | always available after preflight                                 |
| brand       | vowel balance, length 4–10, clean characters, repeated chars, IDN                             | heuristic, low weight                                            |
| seo         | `seo.organic_keywords`, `seo.estimated_organic_traffic`, `seo.authority`                      | null while Semrush is in standby                                 |
| link        | `links.referring_domains`, `links.backlinks`                                                  | null without a backlink provider                                 |
| history     | `rdap.registration_date` age                                                                  | null unless RDAP is enabled and returns a date                   |
| commercial  | dictionary token + `.com.br`, paid keywords                                                   | null without any commercial evidence                             |
| risk        | crawler security block, IDN, randomness, many digits, blacklist                               | higher = riskier; missing reputation is reported, never rewarded |
| acquisition | overall − risk penalty, +5 for registry-release domains, 0 when rejected by rules             |                                                                  |
| confidence  | dimension coverage, provider failures, TTL reuse, skipped deep analysis, evidence consistency | shown with factors in the UI                                     |

## Overall

```
overall = Σ(weight_d × score_d) / Σ(weight_d)   over measured value dimensions only
weights v1: name 0.25, brand 0.20, seo 0.25, link 0.10, history 0.10, commercial 0.10
overall = clamp(overall − riskPenaltyFactor(0.35) × max(0, risk − 10))
```

Rule actions of type `score_adjustment` are applied to the target dimension before aggregation and
are listed in the explanation (`Rule <key>`).

## Explanation

Persisted in `domain_scores.explanation_json`:

```json
{
  "positive": [
    { "signal": "Short SLD", "impact": 20, "evidence": "6 characters", "dimension": "name" }
  ],
  "negative": [
    { "signal": "Digits in name", "impact": -9, "evidence": "1 digit(s)", "dimension": "name" }
  ],
  "missing": [
    {
      "signal": "SEO traffic / keywords",
      "reason": "SEO provider integration mode not yet decided (standby)",
      "dimension": "seo"
    }
  ],
  "confidenceFactors": [
    { "factor": "dimension_coverage", "impact": -57, "detail": "3/7 expected dimensions measured" }
  ],
  "weightsApplied": { "name": 0.455, "brand": 0.364, "commercial": 0.182 },
  "modelVersion": 1
}
```

## Versioning

Score models live in `score_models` (`weights_json`, `config_json`, `version`, `status`). Each
`domain_scores` row records `score_model_version`; reanalysis creates a new row and never rewrites
older ones. To change the model: insert a new version, activate it, re-run analyses as needed.
