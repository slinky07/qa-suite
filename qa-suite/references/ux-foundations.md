# UX Foundations for IA Interpretation

This appendix is optional interpretive material for Bob QA. It can help name
or explain an information-architecture failure that a defined probe has
already demonstrated; it is not a new mandatory oracle.

A finding may mention this appendix, but must still cite a Nielsen
heuristic, platform check, declared project criterion, or measured task
outcome. This appendix can never be the finding's sole justification.

| Concept | How it can help interpret demonstrated evidence | Anti-mechanical guardrail |
|---|---|---|
| Hick–Hyman | When a probe shows delayed, abandoned, or incorrect choice among competing actions, choice uncertainty can explain why alternatives with similar prominence made the primary path harder to select. | Raw control count alone is not a Hick–Hyman violation. Count distinct jobs and demonstrate interference or task impact. |
| Working-memory limits | When a user must remember hidden formats, prior states, or off-screen instructions, the concept helps explain why recognition cues would reduce the demonstrated recall burden. | Visual group count alone is not a working-memory measure. Do not infer a person's memory capacity from the screen. |
| Cognitive load | When evidence shows unrelated work interrupting a core task or terminology forcing repeated translation, distinguish task-inherent work from avoidable interface-imposed load. | Density or complexity is not automatically excessive; identify the extra mental operation and its observed consequence. |
| Gestalt proximity and common region | When IA-02's on-screen interpretation is contradicted by behavior, grouping principles can explain why spacing or containers communicated the wrong relationship or ownership. | A visual grouping difference is not itself a failure; show the incorrect interpretation or task consequence it produced. |
| Norman's gulf of execution | When IA-04 shows that the user cannot map a goal to the correct visible action or predict what that action will do, the concept helps describe the missing bridge from intent to operation. | Do not claim a gulf because an action is unfamiliar; capture the attempted mapping and the absent or contradictory cue. |
| Norman's gulf of evaluation | When IA-05 shows an ambiguous referent or an outcome that cannot be interpreted, the concept helps describe the missing bridge from system state back to user understanding. | Generic feedback is not a failure after a single unambiguous action; demonstrate competing referents or an interpretation mismatch. |
| Fitts's law | When measured misses, repeated pointer travel, or target acquisition problems impede a task, target size and distance can help explain the demonstrated interaction cost. | Scroll depth alone is not a Fitts's-law violation. Cite the relevant platform target check or measured task outcome. |
| Jakob's law | When IA-06 demonstrates that unexpected placement or behavior caused a wrong turn, established project or platform patterns can explain the user's expectation. | Familiarity is not a universal design rule; cite the actual project/platform convention and the failed placement probe. |

Use these concepts to sharpen an evidence-backed explanation, never to turn
a control count, visual impression, or named principle into a finding by
itself.
