# Bendy Menopause Type Quiz — proposed result copy (FOR APPROVAL)

**Status:** proposal only. Nothing in this document has been applied to the
production database. Production Bendy tool: `35aaceb2-8232-42b3-8147-7ce8ca302b5a`
(`/t/bendy-menopause-type-quiz`).

## Source reviewed

Google Doc **"Bendy Menopause Quiz Emails"** (Vanessa) —
https://docs.google.com/document/d/1fS7k7mvL86xknI1cyjVwroC3Kl_7F5VPOXrxFeQiKCc/edit

It contains four result-specific follow-up emails ("Your Results are In!"),
each naming a result type, describing it, giving one "next step", and linking
to Instagram. Its p.s. links the original FormWise form:
`https://app.formwise.ai/form_single/1764802060311x951864235287380000`
(public page title: *"Bendy Menopause Type Quiz (SmartForm)"*).

### What this source DOES establish
- The four official result **names** and Vanessa's voice for each.
- A short **description** and a concrete **next step** per result.
- The CTA used across all results: Instagram `instagram.com/bendymenopause`.

### What it does NOT establish (still missing)
- **Which answers lead to which result** (the FormWise scoring rules). The
  emails are post-result messages; they never mention answer letters.
- **Tie handling** (e.g. 3 × A and 3 × C).
- The on-screen **result page copy** FormWise showed (if it differed from the emails).
- Whether a **booking/consult CTA** existed in addition to Instagram.

These can only come from the FormWise form's own settings (an export, or
someone with FormWise admin access reading the scoring/outcome screens).

## Proposed mapping — names only, scoring unchanged

The current scoring (migration 008) maps option letters to categories. The
email names match those categories closely by theme:

| Letter | Existing category id (unchanged) | Current draft title | **Proposed title (from Vanessa's emails)** | Evidence |
|---|---|---|---|---|
| A | `musculoskeletal_hypermobility` | Musculoskeletal + Hypermobility Pattern | **Myofascial Maverick** | "fascia–muscle–joint system", hypermobility |
| B | `histamine_inflammatory` | Histamine + Inflammatory Reactivity Pattern | **Histamine Hero** | flushing, itching, mast cells, histamine |
| C | `dysautonomia_autonomic` | Dysautonomia + Autonomic Regulation Pattern | **Nervous System Navigator** | autonomic nervous system, dizziness, heart rate |
| D | `complex_multisystem` | Complex Multi-System Pattern | **Complex Conductor** | "symptoms span multiple systems" |

⚠️ The A→category assignment itself was **inferred** in migration 008 from the
option wording; it is not confirmed FormWise scoring. Renaming outcomes does
not change that — please confirm the letter mapping when FormWise access is
available.

Keeping the category ids unchanged means: the 7 questions, all option
mappings, scoring, existing submissions and the tie rule stay exactly as they
are. Only the text a respondent sees changes.

## Proposed `result_config` (to paste in Settings → Result Config, after approval)

Descriptions and recommendations are condensed from the emails, in Vanessa's
wording where possible. Items marked † contain health claims from the emails
("backed by research", specific compression range) — please confirm you are
comfortable showing them on the result page, not only in email.

```json
{
  "outcomes": [
    {
      "id": "musculoskeletal_hypermobility",
      "title": "Myofascial Maverick",
      "description": "Your symptoms tend to show up first in the fascia–muscle–joint system. It's not \"just getting older\" — it's biomechanics, hormones, tissue load and recovery all speaking the same language. Your tissues respond to stability, not intensity: when the foundation feels strong and supported, aches, tension, \"slippy\" joints and fatigue start to settle.",
      "match": { "top_category": "musculoskeletal_hypermobility" },
      "recommendations": [
        "Focus on gentle, consistent loading — especially hips, core and upper back.",
        "Pilates, slow strength training and short movement snacks work well for this physiology.",
        "Prioritise stability and recovery over intensity."
      ],
      "cta_text": "Follow @bendymenopause on Instagram",
      "cta_url": "https://instagram.com/bendymenopause"
    },
    {
      "id": "histamine_inflammatory",
      "title": "Histamine Hero",
      "description": "Your symptoms likely follow a pattern of reactivity — flushing, itching, headaches, temperature swings, gut shifts, irritability, or a sense of reacting to everything lately. This is a physiology pattern, not a personality trait: perimenopause shifts estrogen, which influences mast cells, which influences histamine.",
      "match": { "top_category": "histamine_inflammatory" },
      "recommendations": [
        "Start with sleep stabilisation: a consistent wake time.",
        "Get morning light.",
        "Build a gentle wind-down routine — this one pillar supports mast cell stability for many people."
      ],
      "cta_text": "Follow @bendymenopause on Instagram",
      "cta_url": "https://instagram.com/bendymenopause"
    },
    {
      "id": "dysautonomia_autonomic",
      "title": "Nervous System Navigator",
      "description": "Your symptoms map onto the autonomic nervous system — the part of the body that manages energy, heart rate, temperature and regulation. Crashing out of nowhere, dizziness when standing, a heart rate that feels off, or feeling exhausted but wired are common in perimenopause, especially in bendy bodies.",
      "match": { "top_category": "dysautonomia_autonomic" },
      "recommendations": [
        "Hydration plus electrolytes.",
        "Compression garments (the emails suggest 20–30 mmHg) †.",
        "Pacing and gentle movement — think short walks, not workouts."
      ],
      "cta_text": "Follow @bendymenopause on Instagram",
      "cta_url": "https://instagram.com/bendymenopause"
    },
    {
      "id": "complex_multisystem",
      "title": "Complex Conductor",
      "description": "Your symptoms span multiple systems — pain, energy, gut, mood, temperature, sleep or reactivity. Not because anything is wrong with you, but because your systems talk to each other loudly during hormonal transitions. This pattern isn't rare; it's just rarely recognised.",
      "match": { "top_category": "complex_multisystem" },
      "recommendations": [
        "Start with one stabilising anchor, not everything at once.",
        "Choose a wake-up time you can honour 80–90% of the time this week.",
        "Use early light — outside, by a large window, or bright light — to reinforce your daily rhythm."
      ],
      "cta_text": "Follow @bendymenopause on Instagram",
      "cta_url": "https://instagram.com/bendymenopause"
    }
  ]
}
```

Note: the emails link `http://instagram.com/...`; the proposal uses `https://`.

## Proposed AI personalisation template (optional)

```text
Write a warm, validating, practical result in Vanessa's voice for the person's
Bendy Menopause type, using their actual answers. Explain the pattern as
physiology, not a personality trait or a personal failing. Keep the type name
exactly as given. Include: what their pattern means, which of their answers
point to it, and one or two realistic next steps consistent with the
configured recommendations. Do not invent a new type, do not diagnose or
prescribe, and remind them to work with a qualified clinician.
```

## How to apply (after approval) — no SQL needed

1. Admin → Bendy Menopause Type Quiz → **Settings**.
2. Replace **Result Config (JSON)** with the block above (and the Result
   Template if approved). Leave Scoring Config unchanged.
3. Use **Test Outcome Mapping** → All A / All B / All C / All D, then
   **Run full preview** to check the real AI output.
4. Save. Because the tool is live, the server re-validates the config and
   refuses to save anything that would break scoring.

Rollback: paste the previous Result Config back (copy it before step 2).

## Separate decision: tie rule

With this release, ties resolve by category order (A before B before C before
D). The currently deployed production code sends ties to whichever category
was answered first (to keep that behaviour, add `"tie_breaker": "first_answered"`).
Neither rule is confirmed by FormWise. If FormWise sends ties to Complex
Conductor, add to Scoring Config:
`"tie_breaker": "tie_outcome", "tie_outcome_id": "complex_multisystem"`.
