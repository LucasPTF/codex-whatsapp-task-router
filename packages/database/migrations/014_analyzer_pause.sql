CREATE TABLE analyzer_control(id INTEGER PRIMARY KEY CHECK(id=1),pause_reason TEXT,updated_at TEXT NOT NULL);
INSERT INTO analyzer_control VALUES(1,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
