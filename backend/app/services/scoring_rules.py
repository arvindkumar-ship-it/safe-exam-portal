from decimal import Decimal, ROUND_HALF_UP

ZERO = Decimal("0.00")


def _d(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _empty(a) -> bool:
    return a is None or a == "" or a == [] or (isinstance(a, str) and not a.strip())


def score_mcq_single(q: dict, answer):
    if _empty(answer):
        return ZERO, "EMPTY"
    if answer == q["correctAnswer"]:
        return _d(q["marks"]), "CORRECT"
    return -_d(q.get("negativeMarks", 0)), "WRONG"


def score_mcq_multiple(q: dict, answer):
    if _empty(answer):
        return ZERO, "EMPTY"
    if isinstance(answer, list) and set(answer) == set(q["correctAnswer"]):  # exact match, partial nahi
        return _d(q["marks"]), "CORRECT"
    return -_d(q.get("negativeMarks", 0)), "WRONG"


def score_short_text(q: dict, answer):
    if _empty(answer):
        return ZERO, "EMPTY"
    correct = q.get("correctAnswer")
    if correct is None:
        return ZERO, "MANUAL"
    accepted = [correct] if isinstance(correct, str) else correct
    given = str(answer).strip().casefold()
    if any(given == str(c).strip().casefold() for c in accepted):
        return _d(q["marks"]), "CORRECT"
    return -_d(q.get("negativeMarks", 0)), "WRONG"


SCORERS = {"MCQ_SINGLE": score_mcq_single, "MCQ_MULTIPLE": score_mcq_multiple, "SHORT_TEXT": score_short_text}
