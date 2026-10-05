def test_student_blocked_from_admin_route(client, make_user, auth):
    s = make_user("STUDENT")
    r = client.get("/users", headers=auth(s))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"


def test_admin_allowed(client, make_user, auth):
    assert client.get("/users", headers=auth(make_user("ADMIN"))).status_code == 200


def test_no_token_401(client):
    assert client.get("/users/me").json()["error"]["code"] == "UNAUTHENTICATED"


def test_can_manage_exam_policy(make_user):
    from types import SimpleNamespace as NS
    from app.security.policies import can_manage_exam
    a, b, adm = make_user("INSTRUCTOR"), make_user("INSTRUCTOR"), make_user("ADMIN")
    exam = NS(created_by=a.id)
    assert can_manage_exam(a, exam) and can_manage_exam(adm, exam) and not can_manage_exam(b, exam)
