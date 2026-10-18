# Fonts

Self-hosted under the SIL Open Font License 1.1; each folder keeps its licence.

- `inter/inter-variable-latin.woff2`: Inter 4.1 variable (weight and optical
  size axes) from the `inter-ui` 4.1.0 distribution (upstream
  https://github.com/rsms/inter), subset with fontTools to Latin-1, general
  punctuation, arrows (U+2190–2199), ✓, ×, ÷, °, ≈, ≤, ≥ and − so the page's
  arrows and ticks render in Inter. Headings, the wordmark and all text.
  Licence: `inter/LICENSE.txt`.
- `kalam/`: Kalam 400 and 700, Latin WOFF2 from Fontsource 5.2.8 (upstream
  https://github.com/itfoundry/kalam), for the homepage's handwritten notes
  and stickies. Licence: `kalam/LICENSE.txt`.
- `source-serif-4/`: Source Serif 4, Latin variable WOFF2 (weight axis) from
  Fontsource 5.2.8 (upstream https://github.com/adobe-fonts/source-serif), for
  the contract pages drawn on the homepage. Licence: `source-serif-4/LICENSE.txt`.
- `jetbrains-mono/`: JetBrains Mono, Latin variable WOFF2 from Fontsource
  (upstream https://github.com/JetBrains/JetBrainsMono), for commands.
  Licence: `jetbrains-mono/LICENSE.txt`.

`/fonts/fonts.css` declares the faces and the size-matched `Inter Fallback`
(Arial scaled to Inter's advance widths; ascent and descent from Inter's
1984/-494 per 2048 units, divided by the scale). `/rer-theme.css` names the
stacks; the app, Base's frames, the run site and /run read them from there.
The root document, `/setup` and the sign-in pages link `fonts.css` once
through `src/base/font-head.ts`. Do not import either file from a component.
