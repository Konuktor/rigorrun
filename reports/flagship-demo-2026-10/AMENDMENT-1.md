# Amendment 1: temperature

Written 2026-10-01. Before this: no pilot run, no freeze and no recording.

**What the pre-registration says.** Both variants run at temperature 0.

**Why that has to change.** Google's documentation for the Gemini 3 models recommends leaving
temperature at its default of 1.0. It warns that lower values can make these models loop or
perform worse. The reference agent's author found this while building it, before any run.
Recording a Gemini 3 model at 0 would test a setting its maker advises against. That makes the
model look worse than it is, which is the opposite of a fair demo.

**The rule from now on.**

| Chosen model                                                         | Temperature |
| -------------------------------------------------------------------- | ----------- |
| Model whose official documentation recommends a specific temperature | That value  |
| Any other model                                                      | 0           |

- The value comes from the model's documentation, not from how it behaves in the pilot.
- Both variants use the same value.
- `freeze.json` records the value and the URL of the documentation it came from.

**What follows from a non-zero temperature.** The run is not deterministic. The rule "the first
complete recording is final" therefore matters more, not less. The replay states the temperature
next to the model id.

**Unchanged:** everything else — the variants, the tools, the prompt, the cases, the headline rule.
