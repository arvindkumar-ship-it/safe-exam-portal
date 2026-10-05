from types import SimpleNamespace as NS
from app.services.attempt_question_service import build_question_order, render_questions_for_student
from app.utils.randomization import new_seed, shuffled


def _rows(n=8):
    return [NS(question_id=f"q{i}", position=i + 1,
               snapshot={"id": f"q{i}", "type": "MCQ_SINGLE", "prompt": "p", "marks": 1, "correctAnswer": "a",
                         "explanation": "e", "options": [{"id": x, "text": x} for x in "abcd"]}) for i in range(n)]


def test_same_seed_same_order_different_seed_differs():
    r = _rows()
    a, b = build_question_order(r, 42, True, True), build_question_order(r, 42, True, True)
    assert a == b
    assert a != build_question_order(r, 43, True, True)


def test_all_present_and_mapping_preserved():
    o = build_question_order(_rows(), 7, True, True)
    assert sorted(x["questionId"] for x in o) == [f"q{i}" for i in range(8)]
    assert all(sorted(x["optionOrder"]) == list("abcd") for x in o)
    snaps = {r.question_id: r.snapshot for r in _rows()}
    for q in render_questions_for_student(o, snaps, {}):
        assert {op["id"]: op["text"] for op in q["options"]} == {x: x for x in "abcd"}


def test_no_shuffle_keeps_position_order():
    o = build_question_order(list(reversed(_rows())), 1, False, False)
    assert [x["questionId"] for x in o] == [f"q{i}" for i in range(8)]
    assert o[0]["optionOrder"] == list("abcd")


def test_seed_and_answers_not_in_rendered_output():
    r = _rows()
    o = build_question_order(r, 123456, True, True)
    out = render_questions_for_student(o, {x.question_id: x.snapshot for x in r}, {"q0": {"answerValue": "b", "version": 3}})
    text = str(out)
    assert "123456" not in text and "correctAnswer" not in text and "explanation" not in text
    q0 = next(q for q in out if q["id"] == "q0")
    assert q0["answer"] == {"answerValue": "b", "version": 3} and [q["position"] for q in out] == list(range(1, 9))


def test_input_unchanged_and_seed_range():
    items = list(range(10))
    shuffled(items, 5, "x")
    assert items == list(range(10))
    assert 0 <= new_seed() < 2**31
