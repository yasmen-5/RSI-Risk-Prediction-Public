"""
Programmer RSI Risk Prediction — Flask backend
------------------------------------------------
Loads the trained model bundle (rsi_risk_model.joblib) and serves:
  - GET  /            -> the UI (templates/index.html)
  - POST /predict     -> JSON API that returns the risk prediction

The bundle is a dict with keys: model, label_encoder, feature_names, target_classes
`model` is a full sklearn Pipeline (preprocessing + classifier), so it accepts
raw feature values exactly as entered by the user (no manual scaling needed).
"""

import os
import joblib
import pandas as pd
from flask import Flask, render_template, request, jsonify

APP_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(APP_DIR, "tuned_lr_rsi_risk_model.joblib")

app = Flask(__name__)

# ---- Load the model bundle once at startup ----
bundle = joblib.load(MODEL_PATH)
model = bundle["model"]
label_encoder = bundle["label_encoder"]
feature_names = bundle["feature_names"]  # List of required features by the trained model

# Fields collected directly from the user
RAW_NUMERIC_FIELDS = [
    "Age", "DailySittingHours", "BreakCountPerDay",
    "YearsExperience", "SleepHours", "TypingHoursPerDay", "PainLevel",
]
CATEGORICAL_FIELDS = [
    "Gender", "Posture", "KeyboardType", "DeviceType", "DoesStretching", "JobRole",
]

# Allowed categorical values
CATEGORY_OPTIONS = {
    "Gender": ["Female", "Male"],
    "Posture": ["Good", "Poor"],
    "KeyboardType": ["Standard", "Ergonomic"],
    "DeviceType": ["Laptop", "Desktop"],
    "DoesStretching": ["No", "Yes"],
    "JobRole": ["Student", "Junior Dev", "Senior Dev", "Freelancer"],
}

# Sensible input ranges
NUMERIC_RANGES = {
    "Age": {"min": 18, "max": 70, "step": 1, "default": 30},
    "DailySittingHours": {"min": 0, "max": 16, "step": 0.5, "default": 8},
    "BreakCountPerDay": {"min": 0, "max": 15, "step": 1, "default": 3},
    "YearsExperience": {"min": 0, "max": 40, "step": 0.5, "default": 3},
    "SleepHours": {"min": 0, "max": 12, "step": 0.5, "default": 6.5},
    "TypingHoursPerDay": {"min": 0, "max": 14, "step": 0.5, "default": 5},
    "PainLevel": {"min": 0, "max": 10, "step": 1, "default": 3},
}


@app.route("/")
def index():
    return render_template(
        "index.html",
        numeric_fields=RAW_NUMERIC_FIELDS,
        numeric_ranges=NUMERIC_RANGES,
        category_options=CATEGORY_OPTIONS,
    )


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(force=True)

        # ---- validate presence ----
        missing = [f for f in RAW_NUMERIC_FIELDS + CATEGORICAL_FIELDS if f not in data]
        if missing:
            return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

        # ---- validate + coerce numeric fields ----
        row = {}
        for field in RAW_NUMERIC_FIELDS:
            try:
                row[field] = float(data[field])
            except (TypeError, ValueError):
                return jsonify({"error": f"'{field}' must be a number"}), 400

        # ---- validate categorical fields ----
        for field in CATEGORICAL_FIELDS:
            value = data[field]
            if value not in CATEGORY_OPTIONS[field]:
                return jsonify({
                    "error": f"'{field}' must be one of {CATEGORY_OPTIONS[field]}"
                }), 400
            row[field] = value

        # ---- Derive extra calculated features needed by the model ----
        row["RiskScore"] = row["DailySittingHours"] + row["PainLevel"] - row["BreakCountPerDay"]
        
        # Safe division to prevent DivisionByZero if BreakCountPerDay is 0
        breaks_safe = row["BreakCountPerDay"] if row["BreakCountPerDay"] > 0 else 1.0
        row["TypingToBreakRatio"] = row["TypingHoursPerDay"] / breaks_safe
        row["SittingToBreakRatio"] = row["DailySittingHours"] / breaks_safe

        # Build a single-row DataFrame in the exact column order the pipeline expects
        X = pd.DataFrame([row])[feature_names]

        # Prediction logic
        pred_encoded = model.predict(X)[0]
        label = label_encoder.inverse_transform([pred_encoded])[0]

        proba_by_class = {}
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(X)[0]
            for cls_idx, p in zip(model.classes_, proba):
                cls_label = label_encoder.inverse_transform([cls_idx])[0]
                proba_by_class[cls_label] = round(float(p), 4)

        return jsonify({
            "risk_level": label,
            "probabilities": proba_by_class,
            "risk_score": round(row["RiskScore"], 2),
        })

    except Exception as e:
        print("Error during prediction:", str(e))
        return jsonify({"error": str(e)}), 500

app = app

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
