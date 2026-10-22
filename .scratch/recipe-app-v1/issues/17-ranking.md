# 17: Ranking

**What to build:** After cooking a Recipe, a user can rank it Beli-style.
1. They pick Liked, Fine or Didn't like, which places it in a band: 6.7–10, 3.4–6.6 or 0–3.3.
2. They answer "better or worse than X?" comparisons against Recipes in that band. Binary search finds the exact spot in about log₂(band size) steps.

Skipping the comparisons places it at the middle of its band. Scores are spread evenly within each band: with n Recipes in a band from lo to hi, the one at position i (1 = best) gets hi − (hi − lo) × i / (n + 1), rounded to one decimal. The user can view their whole Ranking with Scores, and re-rank a Recipe after cooking it again. Deleting a Recipe removes it from the Ranking and recomputes its band. Each user ranks on their own, and Friends can read each other's Rankings.

**Blocked by:** 16 (Cook Logs and the Saved/Cooked filter).

**Status:** ready-for-agent

- [ ] Only Cooked Recipes can be ranked
- [ ] Picking a band, then answering comparisons, places the Recipe by binary search within that band
- [ ] Skipping places the Recipe at the middle of its band
- [ ] Scores follow the even-spread formula and update when the band changes
- [ ] The user sees their full Ranking in order with Scores
- [ ] Re-ranking moves the Recipe; deleting a Recipe removes it and recomputes its band
- [ ] Data-layer tests: a known sequence of answers yields the expected position and Score; a band of 100 needs at most 7 comparisons; Friends can read a Ranking, strangers can't
