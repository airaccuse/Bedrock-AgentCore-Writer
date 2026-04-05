# Evaluator Rubric

This rubric is used by the Evaluator agent to score draft quality and gate release.

## Weights

- Narrative Coherence and Causality: 20
- Character Depth and Arc Integrity: 15
- Voice Originality and Stylistic Control: 15
- Scene Craft: 15
- Worldbuilding Integration: 10
- Prose Precision: 10
- Dialogue Authenticity and Subtext: 10
- Market Fit for selected sci-fi lane: 5

## Hard gates

- Overall score must be at least 86.
- No category may be below 70.
- Coherence must be at least 80.
- Scene Craft must be at least 80.

## Rewrite policy

If a draft fails the gate:

- Emit top 3 directives only.
- Each directive must target a concrete span.
- Each directive must estimate score lift.
- Re-evaluate after every revision pass.