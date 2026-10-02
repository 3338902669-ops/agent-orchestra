# Skill catalogue and router

Route a task description to the skills that can serve it, without maintaining a keyword list per skill.

Zero dependencies, Node 18+, plain ESM.

```bash
# 1. build a catalogue from one or more skill directories
node rebuild-skill-catalog.mjs --source mine=~/.claude/skills --source team=./team-skills

# 2. route a task
node skill-router.mjs "the test is failing with a stack trace"
node skill-router.mjs --all
node skill-router.mjs --category coding
echo "draft a changelog entry" | node skill-router.mjs
```

## Why the description is the primary signal

The obvious design is a hand-written keyword list per skill. This implementation exists because
that design does not finish.

A keyword list is a **second, hand-maintained copy** of information that already exists. By
convention every skill's frontmatter carries a `description` written as its trigger — *"Use when
..."* — because that field is how a router is meant to find it, and every author must write one or
the skill is unusable. In the catalogue this was extracted from: **264 of 264 skills had a
description; 121 had keywords.** The keywords were the incomplete copy.

So scoring is led by idf-weighted token overlap over name + description, and keywords are a bonus
when present rather than an entry requirement. Two consequences:

- **Recall is total** — every skill with a description is reachable, with no authoring.
- **A skill nobody categorised, keyworded or promoted is still findable.** The original router
  filtered out `category === 'unmapped'` before ranking, which made 143 of those 264 skills
  selectable on paper and never in practice.

## Why there is a stoplist anyway

Lexical scoring alone is credulous. Splitting Chinese into 2-grams turns function words into
evidence: *"今天天气怎么样"* scored **9.78** against a trends skill — higher than four genuine task
queries. Measured on a 16-query sample, **no threshold on score, match count or coverage separated
the two classes**; only removing function words did.

Hence the distinction this file is built around:

| | nature | can it be finished? |
|---|---|---|
| function words (停用表) | **closed class** — pronouns, question words, time words, quantifiers | yes |
| domain keywords | **open class** | never |

One is a bounded chore. The other is a treadmill. So the engine ships a stoplist and no keyword list.

On the same 16 queries, stoplist + evidence gate scored **16/16**: every genuine task matched, every
irrelevant query refused. That is a 16-query sample, not a labelled corpus — **the stoplist is
expected to grow as real false positives appear.** It will finish. A keyword list would not.

### The gate's contract, stated narrowly

The gate refuses queries whose **only** overlap is function words; it requires two content CJK
tokens, one ASCII token, or an explicit name/keyword hit. It cannot refuse a query that a
description genuinely contains — if a skill says "天气怎么样" and the user asks that, the overlap is
real. Nor can any purely lexical router judge that an overlap is *topically* irrelevant. If you
need that, add embeddings behind the same interface.

## Files

| file | purpose |
|---|---|
| `skill-router.mjs` | scoring and CLI. Also exports `buildIndex`, `topMatch`, `tokenize`, `DEFAULT_STOP` for use as a library |
| `rebuild-skill-catalog.mjs` | scans skill directories, parses frontmatter, writes `skills-catalog.json` + `SKILL-CATALOG.md` |
| `category-map.example.mjs` | copy to `category-map.mjs` to classify skills and add keywords |
| `skill-catalog.test.mjs` | `node --test skill-catalog.test.mjs` |

## Configuration

`skill-catalog.config.json`:

```json
{
  "sources":    { "mine": "~/.claude/skills", "team": "./team-skills" },
  "out":        ".",
  "categories": { "coding": "Coding and debugging", "writing": "Writing" },
  "map":        "./category-map.mjs"
}
```

```bash
node rebuild-skill-catalog.mjs --config skill-catalog.config.json
```

Nothing is hard-coded to a machine. The router finds its catalogue via `--catalog <path>`, the
`SKILL_CATALOG` environment variable, `./skills-catalog.json`, or one beside the script — in that
order.

## Catalogue format

```json
{
  "categories": { "coding": "Coding and debugging" },
  "total": 2,
  "skills": [
    {
      "name": "example-debugger",
      "category": "coding",
      "keywords": [],
      "description": "Track down a failing test or stack trace and find its root cause.",
      "whenToUse": "",
      "locations": [{ "source": "mine", "dir": "example-debugger" }]
    }
  ]
}
```

## Two defects this code encodes

Both were observed on a real 264-skill catalogue and are pinned by tests:

1. **Block-scalar frontmatter.** A line-by-line `key: value` regex reads `description: >-` and
   stores the indicator itself, so every skill using the recommended multi-line form gets a
   description of `">-"`. Worse, any indented line inside the block containing a colon is read as a
   **new key**, letting prose leak into the metadata. 14 entries were affected.
2. **The uncategorised filter.** `category !== 'unmapped'` as a pre-ranking filter silently
   removed 54% of the catalogue from selection.

A third, smaller one: the generated markdown index used to count every skill in its header while
listing only the categorised ones. It now states both numbers and lists both sets.
