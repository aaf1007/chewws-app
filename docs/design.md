# Design

The app's look, and the pieces in `src/ui` that carry it. Every screen draws with these; see the UI rules in `CODING_STANDARDS.md`. To see them all at once, run the app in development and open Profile > UI gallery (`/dev/ui`).

## Visual language

Plain and bright, so the food photos carry the colour.

- **Surfaces** are white. Text is near-black; secondary text is a muted gray. Groups are split by hairline dividers and 1pt borders, not by shadows or tinted cards.
- **One accent**, burnt orange, marks what is active or yours: the selected tab, filled buttons, the selected filter tile or segment, and your own Score. A second accent, indigo, marks Friends' Scores. Nothing else is coloured.
- **Type** is the iOS system font on the iOS text-style scale. Each screen opens with a large, bold, left-aligned title.
- **Shapes** are rounded: about 10pt on tiles, buttons, fields and thumbnails, fully round on badges and pills, 24pt on sheets that slide over a photo.
- **Icons** are outline glyphs (Ionicons) that turn solid when active, usually above a small label.
- **Elevation** is kept for things that float over content, such as the segmented pill near the bottom of a screen.
- A **Score** is a small round badge with a white ring and a bold one-decimal number (`7.8`), sitting on the bottom-left corner of a Recipe's thumbnail.
- **Light mode only** for now.

## Tokens (`src/ui/theme.ts`)

| Colour role    | Use                                                         |
| -------------- | ----------------------------------------------------------- |
| `background`   | Behind every screen                                         |
| `surface`      | Tiles, buttons, cards, the tab bar                          |
| `surfaceMuted` | Search field fill, placeholders, pressed tiles              |
| `text`         | Titles and body text                                        |
| `textMuted`    | Metadata, captions, section headers, inactive tabs          |
| `border`       | 1pt borders and hairline dividers                           |
| `accent`       | Active tab, filled buttons, selected tile/segment, my Score |
| `onAccent`     | Text and icons drawn on `accent` or `friendAccent`          |
| `friendAccent` | Friends' Scores                                             |
| `danger`       | Errors and destructive actions                              |

Also: `spacing` (`xxs` 2 to `xxl` 32), `radii` (`sm`, `md` 10, `lg`, `sheet` 24, `pill`), `typography` (`largeTitle`, `title`, `headline`, `body`, `label`, `caption`, `overline`, and `tabLabel` for the tab bar), `iconSize`, `hairline` and `floatingShadow`.

## Primitives (`src/ui`, exported from `src/ui/index.ts`)

| Primitive        | What it is                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `Screen`         | Safe area, background and optional large title; `scroll` for long content, with a header bar that gets a background once content scrolls under it and a compact title once the large title has gone; works under a navigation header or without one (both in the gallery) |
| `Text`           | Text in a `variant` of the type scale and a colour-role `tone`                                     |
| `Icon`           | An Ionicons glyph in a token size and tone                                                         |
| `Button`         | `filled` (accent), `outlined` or `plain`, with an optional icon; `selected` for one that's on or off (Want to Cook: filled when on) |
| `FilterTiles`    | Three equal tiles, icon above label; the selected one is filled with the accent                    |
| `SearchField`    | Gray rounded field with a magnifier and an optional filter button                                  |
| `ListRow`        | Thumbnail (or placeholder), optional Score badge, bold title with muted suffix, meta lines, ⋮ more |
| `ScoreBadge`     | A 0–10 Score with one decimal; `tone` `mine` (accent) or `friend` (indigo)                         |
| `SectionHeader`  | Small uppercase muted heading, with an optional action                                             |
| `ActionButtons`  | A row of outlined buttons, icon above label                                                        |
| `FloatingSegment` | White pill of segments floating at the bottom centre (`List \| Map`)                               |
| `AddField`       | Gray rounded field with an Add button at its right, for adding one thing by name (Pantry, Staples) |
| `IngredientRow`  | An Ingredient's name with an optional action at its right ("Used up", "Remove"), over a hairline   |
| `ShoppingListRow` | A Shopping List line: optional check circle, name with muted detail lines (each Recipe's amounts), optional action; checked lines are muted and struck through |
| `SyncNotice`     | Gray rounded notice that list changes are waiting to sync: a slashed cloud while offline, arrows while sending, a clock while waiting to retry after a server error |
| `NavRow`         | A row that opens another screen: accent icon, bold label ("Drafts (2)"), muted detail, chevron |
| `SourceVideoCard` | Bordered card for the video a Recipe came from: portrait thumbnail (or placeholder), platform overline, creator, accent "Watch on TikTok"; opens the video when pressed. `kind="page"` for a web page: square picture (globe placeholder), the site as overline, "Open the page". An Instagram Reel is the plain card (the word "Instagram", no logo) or the user's screenshot as its picture. `onThumbnailError` lets the screen re-fetch an expired thumbnail |
| `DraftBanner`    | Gray rounded banner on a Draft: building (hourglass), recipe not in caption (accent page), failed (red alert), couldn't read the source (accent slashed eye), with a bold title, muted message and small accent actions ("Try again") |
| `ScreenshotField` | A screenshot the user adds to a link: label over an outlined "Add screenshot" button, or the picture in a bordered row with accent "Change" and red "Remove" |
| `TagChips`, `TagChip`, `SuggestedTagChip` | A wrapping row of Tags as pills. `TagChip`: a Recipe's Tag in gray with a × ("Remove Italian"). `SuggestedTagChip`: a Draft's suggested Tag, accent-filled and ticked while kept, outlined with a + while left out; tapping switches |
| `EmptyState`     | Centred icon, title and message for a screen with nothing in it yet                                |
| `tabScreenOptions`, `tabIcon` | The signed-in tab bar's style and icons                                               |
