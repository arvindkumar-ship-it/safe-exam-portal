def put(client, auth, s, aid, qid, val, ver):
    return client.put(f"/attempts/{aid}/answers/{qid}", json={"answerValue": val, "version": ver}, headers=auth(s))


def test_save_update_and_list(started, client, auth):
    i, s, exam, v = started()
    aid, qid = v["id"], v["questions"][0]["id"]
    r = put(client, auth, s, aid, qid, "o1", 0)
    assert r.json()["data"]["version"] == 1
    assert put(client, auth, s, aid, qid, "o2", 1).json()["data"]["version"] == 2
    lst = client.get(f"/attempts/{aid}/answers", headers=auth(s)).json()["data"]
    assert lst[0]["answerValue"] == "o2" and lst[0]["version"] == 2


def test_other_student_404(started, client, auth, make_user):
    i, s, exam, v = started()
    o = make_user("STUDENT")
    assert put(client, auth, o, v["id"], v["questions"][0]["id"], "o1", 0).status_code == 404


def test_unknown_question(started, client, auth):
    i, s, exam, v = started()
    r = put(client, auth, s, v["id"], "nope", "o1", 0)
    assert r.status_code == 404 and r.json()["error"]["code"] == "QUESTION_NOT_IN_ATTEMPT"


def test_submitted_blocked(started, client, auth):
    i, s, exam, v = started()
    client.post(f"/attempts/{v['id']}/submit", headers=auth(s))
    r = put(client, auth, s, v["id"], v["questions"][0]["id"], "o1", 0)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ATTEMPT_ALREADY_SUBMITTED"


def test_duplicate_same_request_safe(started, client, auth):
    i, s, exam, v = started()
    aid, qid = v["id"], v["questions"][0]["id"]
    a = put(client, auth, s, aid, qid, "o1", 0).json()["data"]
    b = put(client, auth, s, aid, qid, "o1", 0).json()["data"]  # retry after lost response
    assert a["version"] == b["version"] == 1


def test_version_conflict_returns_current(started, client, auth):
    i, s, exam, v = started()
    aid, qid = v["id"], v["questions"][0]["id"]
    put(client, auth, s, aid, qid, "o1", 0)
    put(client, auth, s, aid, qid, "o2", 1)
    r = put(client, auth, s, aid, qid, "o3", 1)  # stale
    e = r.json()["error"]
    assert r.status_code == 409 and e["code"] == "ANSWER_VERSION_CONFLICT"
    assert e["details"] == {"version": 2, "answerValue": "o2"}
    assert put(client, auth, s, aid, v["questions"][1]["id"], "o1", 5).status_code == 409  # row nahi, version != 0


def test_invalid_values(started, client, auth):
    i, s, exam, v = started()
    aid, qid = v["id"], v["questions"][0]["id"]
    for bad in ("zzz", ["o1"], None, 5):
        r = put(client, auth, s, aid, qid, bad, 0)
        assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_ANSWER"


def test_multiple_and_short_text_validation(client, make_user, auth, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, n=2, types=["MCQ_MULTIPLE", "SHORT_TEXT"])
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
    by_type = {q["type"]: q["id"] for q in v["questions"]}
    aid = v["id"]
    m, t = by_type["MCQ_MULTIPLE"], by_type["SHORT_TEXT"]
    assert put(client, auth, s, aid, m, ["o1", "o3"], 0).status_code == 200
    assert put(client, auth, s, aid, m, ["o1", "o1"], 1).status_code == 422
    assert put(client, auth, s, aid, m, ["o9"], 1).status_code == 422
    assert put(client, auth, s, aid, m, "o1", 1).status_code == 422
    assert put(client, auth, s, aid, t, "four", 0).status_code == 200
    assert put(client, auth, s, aid, t, "x" * 2001, 1).status_code == 422
