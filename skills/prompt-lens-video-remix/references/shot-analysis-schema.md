# Shot analysis schema

Analyze only what the extracted evidence supports. Use `observed`, `inferred`, or `unknown` when confidence materially affects the result.

## Overall result

```json
{
  "source": "local filename or user-provided link",
  "durationSeconds": 0,
  "aspectRatio": "16:9",
  "sceneCount": 0,
  "summary": "What happens across the full video",
  "narrativeStructure": ["hook", "development", "payoff"],
  "visualLanguage": "Recurring composition, camera, light, color and texture",
  "editingRhythm": "How shot duration and transitions shape pace",
  "audioStatus": "observed, transcribed, unavailable, or unknown",
  "scenes": []
}
```

## Scene result

Produce one entry for every scene in `manifest.json`:

```json
{
  "sceneIndex": 1,
  "start": 0.0,
  "end": 2.4,
  "duration": 2.4,
  "storyBeat": "The narrative purpose of this shot",
  "visual": {
    "sceneDescription": "Exhaustive visible-frame reconstruction",
    "subject": "Primary subject and defining visible traits",
    "characters": ["Appearance, wardrobe, expression and pose"],
    "environment": "Location, props, background and depth layers",
    "action": "Observed or inferred temporal action",
    "camera": "Shot size, angle, movement, focus and speed",
    "composition": "Foreground, middle ground, background and subject placement",
    "lighting": "Direction, quality, contrast and practical sources",
    "color": "Palette and grading",
    "style": "Medium, texture and realism",
    "motion": "Subject, camera and environmental motion"
  },
  "audio": {
    "dialogue": [],
    "narration": [],
    "music": "unknown",
    "soundEffects": [],
    "confidence": "unknown"
  },
  "transition": {
    "in": "cut, fade, continuation, or unknown",
    "out": "cut, fade, continuation, or unknown",
    "pacing": "slow, measured, fast, accelerating, or mixed"
  },
  "generationPrompt": "A standalone prompt that can recreate this scene without seeing the source",
  "confidenceNotes": ["Important uncertainty or evidence limitation"]
}
```

## Evidence rules

- Three sampled frames establish visible appearance and change across the segment; they do not prove every intermediate action.
- Describe a camera move only when relative framing across frames supports it. Otherwise write `static or motion not established`.
- Treat exact lens focal length, camera model, LUT, celebrity identity, brand, location, and copyrighted character identity as unknown unless clearly established and relevant.
- Do not turn uncertainty into decorative specificity. A useful prompt can state the visible result without inventing production facts.
- `generationPrompt` must be self-contained and concrete. It must not say “same as the reference,” “change the original,” or rely on an unseen image.

## Presentation

Show users a readable Markdown summary and shot table first. Include JSON only when they ask for machine-readable output or when it will be consumed by another tool.
