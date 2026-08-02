# Programmer RSI Risk Prediction

A Flask + HTML/CSS/JS web app that takes a programmer's daily work habits and
uses the trained model (a full sklearn Pipeline with Logistic Regression) to
predict RSI (Repetitive Strain Injury) risk. The UI is in English and displays
**Low / Medium / High** risk.

## About the Low / Medium / High display

The trained model itself is **binary** — it was trained to output only
**Low** or **High** (the "Medium" class in the original dataset was removed
before training the deployed model; see the notebook's section 14).

To still show three levels in the UI (matching the requested design), the
app buckets the model's `P(High risk)` probability into three bands on the
frontend (`static/script.js`):

```
P(High) < 35%         -> Low
35% <= P(High) < 65%  -> Medium
P(High) >= 65%         -> High
```

This is a **derived confidence zone around the model's decision boundary**,
not a separately trained Medium class — the UI states this explicitly under
the result. If you want a real 3-class model, the notebook already has a
multi-class (Low/Medium/High) pipeline trained in section 10 — you'd need to
save and use *that* bundle instead of the binary one from section 14.

## Note about the uploaded files

The files uploaded as `programmer_rsi_risk_dataset.csv` and
`programmer_rsi_model.joblib` are **byte-for-byte the same file** — the
saved model (joblib), not a real CSV.

The cause is visible in the training notebook itself, in the last cell:

```python
model_path = r"C:\Users\Kareem\Downloads\programmer_rsi_risk_dataset.csv"
joblib.dump(model_bundle, model_path)
```

The original dataset's filename was accidentally reused as the save path for
the model, instead of something like `best_rsi_risk_model.joblib`. So the
file with the `.csv` extension is actually the pickled model, and no raw
training data was ever sent.

**This doesn't affect the app** — it only needs the model, which works fine.
If you want to use the original training data later (for further analysis),
you'd need to re-upload the real CSV from wherever it lives on your machine.

## Project structure

```
rsi_app/
├── app.py                     # Flask backend (loads the model + /predict API)
├── rsi_risk_model.joblib      # copy of the trained model you uploaded
├── requirements.txt
├── templates/
│   └── index.html             # input form + result display
└── static/
    ├── style.css
    └── script.js
```

## Running locally

```bash
cd rsi_app
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open your browser at: `http://127.0.0.1:5000`

## How the model predicts

- The model is a full `sklearn.Pipeline` (preprocessing + Logistic
  Regression), saved inside a dict with keys: `model`, `label_encoder`,
  `feature_names`, `target_classes`.
- Fields collected directly from the user: age, gender, sitting hours,
  break count, years of experience, sleep hours, typing hours, pain level,
  sitting posture, keyboard type, device type, whether they stretch, and
  job role.
- One extra column, **RiskScore**, was used during training and is **not**
  asked from the user — it's derived automatically:

  ```
  RiskScore = DailySittingHours + PainLevel - BreakCountPerDay
  ```

  The server (`app.py`) computes it automatically before sending data to
  the model.

## Frontend features

- **Prediction tab** — the form + gauge/donut/risk-factor result view.
- **History tab** — every prediction is stored locally in the browser
  (`localStorage`, nothing sent to a server) and plotted as a simple trend
  line.
- **Tips tab** — static RSI-prevention guidance.
- **Export Report** — downloads a plain-text summary of the current
  prediction and inputs, generated entirely client-side.
- **Light / dark theme toggle**, persisted in the browser.

## API

`POST /predict` — accepts JSON with all 13 fields (without RiskScore) and
returns:

```json
{
  "risk_level": "High",
  "probabilities": {"Low": 0.01, "High": 0.99},
  "risk_score": 14.0
}
```
