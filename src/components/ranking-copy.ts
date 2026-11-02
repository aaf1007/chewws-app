import type { RankingBand } from '@/data';
import type { BandOption } from '@/ui';

/** The bands best first, as the band picker and the Ranking screen show them (decisions 17). */
export const BANDS: readonly BandOption<RankingBand>[] = [
  { value: 'liked', label: 'Liked', range: '6.7–10', icon: 'heart-outline' },
  { value: 'fine', label: 'Fine', range: '3.4–6.6', icon: 'remove-circle-outline' },
  { value: 'disliked', label: 'Didn’t like', range: '0–3.3', icon: 'thumbs-down-outline' },
];

/** A band's name: "Liked", "Fine", "Didn’t like". */
export const bandLabel = (band: RankingBand) => BANDS.find((b) => b.value === band)?.label ?? band;

/** Where a Recipe sits in its band: "#2 in Liked". */
export const placeLabel = (band: RankingBand, position: number) => `#${position} in ${bandLabel(band)}`;
