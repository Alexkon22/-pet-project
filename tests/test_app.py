from app import app


def test_health_ok():
    client = app.test_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_add_task_redirects_home():
    client = app.test_client()
    response = client.post("/add", data={"task": "CI task"})
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/")

    home = client.get("/")
    assert home.status_code == 200
    assert "CI task".encode("utf-8") in home.data
