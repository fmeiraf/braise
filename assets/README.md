# braise brand kit: Growth Rings

Every venture is a living cross-section. Each strategy revision lays down a ring, and
agents at work grow the outer ring. The mark is an off-centre pith (resin), two growth
rings and an outer ring that is still being drawn.

## Files

- `svg/`: masters. `braise-mark-*` (symbol), `braise-wordmark-*` (name only),
  `braise-horizontal-*` (lockup), `braise-icon.svg` (app tile on pith),
  `braise-mark-animated.svg` (the outer ring drawing itself, SMIL, for splash and
  README use). `ink` artwork is for light grounds, `light` for pith or dark grounds.
  The wordmark is Bricolage Grotesque, outlined: no font needed.
- `png/`: raster exports of the masters.
- `web/`: favicons (a simplified mark below 48px: pith and one growing ring), ICO,
  Apple touch icon, PWA icons, maskable icon, manifest and head snippet. The web app
  serves this folder as its public root.
- `social/`: 1024px avatar, 1200x630 link card, 1500x500 banner.
- `brand.css` and `brand-tokens.json`: palette, venture ring hues and fonts.

## Palette

Pith #131a16 (rail, icon tile), sage #e8ede5 (ink on pith), ground #f4f5f1, paper
#ffffff, ink #151b18. Resin #f0a63a is the one accent: the primary action and live
state only; resin-deep #b8720f for text on light grounds. Moss #4f7a45 marks done,
bark #b23a24 errors. Each venture owns one ring hue from the eight in the tokens.

## Usage

Give the mark clear space of at least the pith dot's diameter. Keep the outer ring's
gap at the upper right; never close it, rotate the mark or recolour the pith. Motion is
limited to the outer ring drawing itself, and only when something is actually live.

## Provenance

All artwork is authored geometry generated from code in this session (2026-11-24);
no image generation or stock. Rasters are rendered from the SVG masters with
`rsvg-convert`. Not trademark-cleared.
