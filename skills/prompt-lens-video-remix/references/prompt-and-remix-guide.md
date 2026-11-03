# Prompt construction and remix guide

Read this reference after the factual breakdown when the user wants prompts, a rewritten story, a same-structure remake, or generated media.

## Standalone generation prompt

Write each scene prompt in this order:

1. Duration and intended shot role.
2. Subject identity, appearance, wardrobe, expression, and starting pose.
3. Environment, props, background layers, weather, and time of day.
4. Action in temporal order from the beginning through the end of the shot.
5. Shot size, camera angle, camera movement, focus behavior, and perceived speed.
6. Composition and depth relationships.
7. Lighting direction, contrast, palette, grade, texture, and realism.
8. Dialogue, narration, sound, and transition only when available or requested.
9. Negative constraints that prevent likely contradictions, kept short and specific.

Use concrete visual language. Avoid model-specific parameters unless the user has selected a model that supports them.

## Rewrite branch

Apply the user's creative direction to the full sequence, including dependent details. A change of character, era, setting, or product must also update wardrobe, props, action, dialogue, sound, and continuity where relevant.

Preserve only the elements the user asked to retain. Common retainable structures are:

- scene count and duration;
- hook, development, and payoff;
- shot-size progression;
- camera movements and transition rhythm;
- reveal timing and action beats.

Return:

1. New overall premise.
2. Continuity notes for recurring characters, products, and environments.
3. Rewritten scene table.
4. A standalone generation prompt for every scene.
5. Optional assembly notes for pacing, sound, and transitions.

## Same-structure remake branch

Preserve the reference's structural grammar while creating independent content. Replace names, recognizable characters, logos, dialogue, distinctive artwork, and identifying branded elements unless the user confirms they own or may reproduce them.

For every scene, explicitly map:

- retained timing and camera logic;
- replacement subject and environment;
- new action that fulfills the same narrative function;
- new generation prompt;
- continuity dependency on the previous and next scenes.

Do not describe the output as a guaranteed one-to-one copy. Explain which aspects are observed, which are inferred, and which were deliberately transformed.

## Actual generation

Before submitting a generation job:

- identify the provider and model;
- show the final prompt and media inputs;
- state the requested duration, aspect ratio, resolution, and number of outputs;
- disclose the known or estimated charge;
- obtain explicit confirmation.

Save returned task identifiers and results in the user's chosen workspace. Do not repeatedly submit an uncertain or timed-out paid request; check its status first.
