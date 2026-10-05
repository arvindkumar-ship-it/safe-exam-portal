from app.services.question_service import to_student_view
from app.utils.randomization import shuffled


def build_question_order(exam_questions, seed: int, shuffle_questions: bool, shuffle_options: bool) -> list[dict]:
    rows = sorted(exam_questions, key=lambda r: r.position)
    if shuffle_questions:
        rows = shuffled(rows, seed, "questions")
    order = []
    for r in rows:
        opts = r.snapshot.get("options") or []
        ids = [o["id"] for o in opts]
        if shuffle_options and ids:
            ids = shuffled(ids, seed, f"options:{r.question_id}")
        order.append({"questionId": r.question_id, "optionOrder": ids})  # sirf ids; mapping preserved
    return order


def render_questions_for_student(order, snapshots_by_id: dict, answers_by_qid: dict) -> list[dict]:
    out = []
    for pos, item in enumerate(order, 1):
        view = to_student_view(snapshots_by_id[item["questionId"]])
        if view["options"]:
            by_id = {o["id"]: o for o in view["options"]}
            view["options"] = [by_id[i] for i in item["optionOrder"] if i in by_id]
        a = answers_by_qid.get(item["questionId"])
        if a is not None:
            val, ver = (a["answerValue"], a["version"]) if isinstance(a, dict) else (a.answer_value, a.version)
            view["answer"] = {"answerValue": val, "version": ver}
        else:
            view["answer"] = None
        view["position"] = pos
        out.append(view)
    return out
