# Fonts

Brygada 1918 (headings, key dates and numerals) and Libre Franklin (everything
else) are self-hosted under the SIL Open Font License 1.1, in
`brygada1918/LICENSE.txt` and `libre-franklin/LICENSE.txt`. Each WOFF2 is the
Latin subset of the upstream variable font as Google Fonts publishes it, with
the weight axis kept.

`fonts.css` declares both faces and their local fallbacks. The root document,
`/setup` and the sign-in pages link it once through `src/base/font-head.ts`,
which preloads both files. Do not import this CSS from a component.

The fallback faces scale Arial (for Libre Franklin) and Georgia (for Brygada)
to each web font's average advance width over A-Z, a-z and 0-9 at the weights
used (400/500 and 600/700); ascent and descent are the web font's hhea values
divided by that scale. Recalculate them when changing a face.
