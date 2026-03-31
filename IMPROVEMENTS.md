# HMM & GBT Improvement Roadmap

This document outlines the strategic differences between the current modeling approaches and provides a roadmap for moving the `msr-offroad` prediction engine toward State-of-the-Art (SOTA) performance.

## 1. HMM Engine: Baum-Welch vs. Viterbi

| Algorithm | Primary Role | Suitability for Racing |
| :--- | :--- | :--- |
| **Baum-Welch** | **Training & Inference** | **Superior**: This "Soft EM" approach sums over all possible regime paths. It handles the high noise/uncertainty of racing without overfitting to outliers. |
| **Viterbi** | **Diagnostics & Display** | **Secondary**: Useful for identifying the single most likely current "Regime" for the UI, but too brittle for core probability estimation as it ignores all but the "best" path. |

### Recommendation
Continue using **Baum-Welch** (specifically the Forward algorithm) for the core prediction logic to maintain Bayesian-optimal forecasting.

---

## 2. GBT Engine: XGBoost vs. The Competition

| Model | Strengths | Use Case in msr-offroad |
| :--- | :--- | :--- |
| **XGBoost** | Tabular power, Payout ranking. | Currently used in `backtest-gbt.ts` for cross-sectional predictions. |
| **CatBoost** | Native categorical handling. | **SOTA Upgrade**: Better at handling Monster/Player names and Venue IDs without complex encoding. |
| **HMM-Ensemble** | Temporal context/Memory. | Best for identifying "streaks" or session-specific patterns. |

---

## 3. The "Hybrid Engine": Stacking & Ensembling

The single biggest performance gain is moving from parallel models to an **Ensemble Stacking** architecture.

### Immediate Improvement: Blending
Modify `prediction-engine.ts` to blend the HMM and GBT probabilities:
```typescript
const finalProb = (hmmProb * 0.4) + (gbtProb * 0.6);
```

### Future SOTA: Meta-Modeling
1.  **Level 0 Inputs**: Train HMM, GBT, and Payout Stats.
2.  **Level 1 Meta-Model**: Train a simple Logistic/Ridge Regression model that takes the *outputs* of Level 0 as *inputs* to decide the final confidence score.

---

## 4. Feature Engineering: Beyond Static Metadata

To improve the GBT/XGBoost model, we must introduce **Memory** into its features:

*   **Lag Features**: Added column for "Winner of Round - 1".
*   **Rolling Stats**: Instead of total historical win rate, use:
    *   `last_5_win_rate` (Recency)
    *   `last_20_win_rate` (Stability)
*   **EMA (Exponential Moving Average)**: Give higher weight to more recent wins/losses for each monster.

---

## 5. Next Steps for Implementation

1.  **[ ] Ensemble Integration**: Integrate `gbt-engine.ts` directly into the main `backtest.ts` to compare ensembled EV vs. standalone EV.
2.  **[ ] HMM-Augmented GBT**: Add the HMM "Consensus Regime" index as a categorical feature to the GBT training set.
3.  **[ ] CatBoost Trial**: Test if CatBoost yields better accuracy than the current XGBoost implementation on Monster/Venue features.
4.  **[ ] Sliding Window Backtest**: Optimize `trainingRestarts` and `trainingIterations` based on the most recent 100 races only (Recency focus).
