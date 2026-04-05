# Architecture

## Pipeline

1. NarrativeFoundry creates architecture and scene cards.
2. Ghostwriter drafts prose for target scene.
3. Compression tightens line-level expression.
4. Continuity checks canon and timeline consistency.
5. Style checks voice conformance.
6. Evaluator scores quality and emits pass or rewrite.
7. Rewrite loop repeats until quality gate passes or max iterations reached.

## Primary artifacts

- Story architecture JSON
- Scene cards JSON
- Draft prose JSON
- Evaluator report JSON
- Revision directives JSON

## Gate policy

Release only when evaluator hard gates pass.