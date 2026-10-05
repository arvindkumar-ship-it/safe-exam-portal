def _setup(make_user, mk_exam, mk_q, n=3):
    i = make_user("INSTRUCTOR")
    return i, mk_exam(i), [mk_q(i) for _ in range(n)]


def test_attach_duplicate_detach_reorder(client, make_user, auth, mk_exam, mk_q):
    i, exam, qs = _setup(make_user, mk_exam, mk_q)
    h = auth(i)
    for q in qs:
        assert client.post(f"/exams/{exam.id}/questions", json={"questionId": q.id}, headers=h).status_code == 201
    dup = client.post(f"/exams/{exam.id}/questions", json={"questionId": qs[0].id}, headers=h)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "VALIDATION_ERROR"
    ids = [qs[2].id, qs[0].id, qs[1].id]
    r = client.put(f"/exams/{exam.id}/questions/order", json={"questionIds": ids}, headers=h)
    assert [x["questionId"] for x in r.json()["data"]] == ids
    assert [x["position"] for x in r.json()["data"]] == [1, 2, 3]
    assert client.delete(f"/exams/{exam.id}/questions/{qs[0].id}", headers=h).status_code == 200
    listing = client.get(f"/exams/{exam.id}/questions", headers=h).json()["data"]
    assert [x["position"] for x in listing] == [1, 2]
    bad = client.put(f"/exams/{exam.id}/questions/order", json={"questionIds": [qs[1].id]}, headers=h)
    assert bad.status_code == 422


def test_position_insert_contiguous(client, make_user, auth, mk_exam, mk_q):
    i, exam, qs = _setup(make_user, mk_exam, mk_q)
    h = auth(i)
    client.post(f"/exams/{exam.id}/questions", json={"questionId": qs[0].id}, headers=h)
    client.post(f"/exams/{exam.id}/questions", json={"questionId": qs[1].id}, headers=h)
    client.post(f"/exams/{exam.id}/questions", json={"questionId": qs[2].id, "position": 1}, headers=h)
    listing = client.get(f"/exams/{exam.id}/questions", headers=h).json()["data"]
    assert [x["questionId"] for x in listing][0] == qs[2].id and [x["position"] for x in listing] == [1, 2, 3]


def test_inactive_and_foreign_question_rejected(client, make_user, auth, mk_exam, mk_q, db):
    i, exam, qs = _setup(make_user, mk_exam, mk_q, 1)
    other = make_user("INSTRUCTOR")
    foreign = mk_q(other)
    qs[0].is_active = False
    db.commit()
    h = auth(i)
    assert client.post(f"/exams/{exam.id}/questions", json={"questionId": qs[0].id}, headers=h).status_code == 422
    assert client.post(f"/exams/{exam.id}/questions", json={"questionId": foreign.id}, headers=h).status_code == 404


def test_published_blocks_changes(client, make_user, auth, pub_exam, mk_q):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i, n=1)
    h = auth(i)
    extra = mk_q(i)
    assert client.post(f"/exams/{exam.id}/questions", json={"questionId": extra.id}, headers=h).json()["error"]["code"] == "EXAM_NOT_EDITABLE"
    qid = client.get(f"/exams/{exam.id}/questions", headers=h).json()["data"][0]["questionId"]
    assert client.delete(f"/exams/{exam.id}/questions/{qid}", headers=h).status_code == 409
