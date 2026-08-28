# Mira

An unofficial explorer for the **percentile learning curves** of CharaChorder devices.

The trend lines published alongside
[Tangent's Unofficial CharaChorder and Forge Learning Progress Statistic][sheet]
answer "how fast does a typical person get?". Mira answers the question next to it:
*where do I sit among everyone else at the same point in my practice?* — by fitting a
curve to the 10th, 25th, 50th, 75th and 90th percentile of shared records rather than
to their average.

[sheet]: https://docs.google.com/spreadsheets/d/1okhYnt4cz8Zzh2WKNzPs9drqaoudCeT7VN2O9UzTTFM/edit

## The model

Each percentile is its own fit of

```
wpm = a · days^b        i.e.   log(wpm) = A + B · log(days)
```

found by minimising [pinball loss][pinball] on `log(wpm)` — a quantile regression.
Quantiles survive monotone transforms, so the τ-quantile of `log(wpm)` really is the
log of the τ-quantile of `wpm`; fitting in log space and exponentiating is exact here
in a way it would not be for a mean.

For a fixed slope `B` the optimal intercept is exactly the τ-quantile of the residuals,
which leaves a one-dimensional convex problem — solved by ternary search, no gradients
and no local minima.

[pinball]: https://en.wikipedia.org/wiki/Quantile_regression

## What the curves do not say

- **One record is one observation.** The spreadsheet carries no identity for anyone who
  contributed, by design, so the curves describe the distribution of *records*, not of
  *people*: someone who logs their speed daily weighs more than someone who logs it twice.
- **The tail of every series is thin.** 95% of CC1's records fall on or before day 358,
  out of a fitted range that runs to day 1078. The chart marks where that happens.
- **`CC1 & CC2 & M4G` is deliberately more than the three device series added together.**
  It is the series that follows someone across a device change, so it takes in the two
  transfer datasets as well — 2,703 records against the single devices' 2,590. Each
  single-device series stops at the switch and counts nothing logged after it.
- **CCL, CCX and the two transfer series are not drawn.** They have under 50 records, or
  their first record is already weeks in — which leaves the exponent fixed by too short a
  stretch of `log(days)` to extrapolate back to day 1.

## Working on it

```sh
npm install
npm run dev          # http://localhost:5173/mira/
npm run build
npm run lint
```

### Refreshing the data

```sh
npm run fetch:data                  # download the sheets Mira reads, to data/raw/
npm run build:curves                # refit and rewrite data/curves.json
npm run build:data                  # both
node scripts/fetch-sheets.mjs --list   # what the spreadsheet publishes
node scripts/fetch-sheets.mjs --all    # all of it, not just what Mira reads
```

`fetch-sheets.mjs` reads the spreadsheet's *publish to web* mirror, so no credentials
are involved and there is no gid list to keep in sync — `--list` and `--all` pick up a
newly published sheet on the next run.

By default it fetches only `Processed Data`, the one sheet `build-curves.mjs` reads.
The spreadsheet also publishes chart-only sheets and pre-computed statistics in two
languages; Mira uses none of them, so they stay out of the repository.

## Privacy

Your own records are held in `localStorage` and go nowhere else. Mira has no account, no
backend and no analytics.

---

Unofficial. Not affiliated with CharaChorder.
