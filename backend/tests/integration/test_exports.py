import csv
import io


def test_csv_header_rows_and_injection_escape(client, make_user, auth, pub_exam):
    i = make_user("INSTRUCTOR")
    s = make_user("STUDENT", name="=HYPERLINK(\"http://evil\")")
    exam = pub_exam(i, n=1)
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
    client.put(f"/attempts/{v['id']}/answers/{v['questions'][0]['id']}", json={"answerValue": "o2", "version": 0}, headers=auth(s))
    client.post(f"/attempts/{v['id']}/submit", headers=auth(s))
    r = client.get(f"/exams/{exam.id}/export/results.csv", headers=auth(i))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == ["studentEmail", "studentName", "attemptStatus", "totalMarks", "maxMarks", "passed", "riskLevel"]
    assert rows[1][0] == s.email and rows[1][2] == "SUBMITTED" and rows[1][3] == "1.0" and rows[1][6] == "NORMAL"
    assert rows[1][1].startswith("'=")  # formula injection escaped


def test_student_403_and_foreign_instructor_404(client, make_user, auth, pub_exam):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i)
    assert client.get(f"/exams/{exam.id}/export/results.csv", headers=auth(make_user("STUDENT"))).status_code == 403
    assert client.get(f"/exams/{exam.id}/export/results.csv", headers=auth(make_user("INSTRUCTOR"))).status_code == 404


def test_audit_export_includes_chain_verification(started, client, auth):
    i, s, exam, v = started()
    ex = client.get(f"/reviews/attempts/{v['id']}/export", headers=auth(i)).json()["data"]
    assert ex["verification"] == {"valid": True, "brokenAt": None}
