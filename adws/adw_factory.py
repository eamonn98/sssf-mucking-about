#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""Single-worker filesystem job factory. Job records live in the SSSF SQLite DB."""
from __future__ import annotations

import argparse
import os
import signal
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

import yaml


STATES = {"QUEUED", "CLAIMED", "PLANNING", "SCOUTING", "BUILDING", "TESTING",
          "REVIEWING", "DOCUMENTING", "COMPLETED", "REWORK", "FAILED", "HUMAN_REQUIRED"}
ACTIVE = {"CLAIMED", "PLANNING", "SCOUTING", "BUILDING", "TESTING", "REVIEWING", "DOCUMENTING"}
TRANSITIONS = {
    "QUEUED": {"CLAIMED"}, "REWORK": {"CLAIMED"}, "CLAIMED": {"PLANNING", "SCOUTING", "BUILDING", "REWORK", "HUMAN_REQUIRED"},
    "PLANNING": {"SCOUTING", "BUILDING", "REWORK", "HUMAN_REQUIRED"},
    "SCOUTING": {"BUILDING", "REWORK", "HUMAN_REQUIRED"},
    "BUILDING": {"TESTING", "REVIEWING", "REWORK", "HUMAN_REQUIRED"},
    "TESTING": {"BUILDING", "REVIEWING", "REWORK", "HUMAN_REQUIRED"},
    "REVIEWING": {"BUILDING", "TESTING", "DOCUMENTING", "REWORK", "HUMAN_REQUIRED"},
    "DOCUMENTING": {"COMPLETED", "REWORK", "HUMAN_REQUIRED"},
}
PHASE_STATE = {"plan": "PLANNING", "build": "BUILDING", "test": "TESTING",
               "retest": "TESTING", "review": "REVIEWING", "revise": "BUILDING",
               "document": "DOCUMENTING"}


@dataclass
class Job:
    id: str
    title: str
    description: str
    acceptance_criteria: list[dict]
    priority: str = "normal"
    workspace: str | None = None


class JobSource(Protocol):
    def discover(self) -> list[Job]: ...


class FilesystemJobSource:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def discover(self) -> list[Job]:
        self.directory.mkdir(parents=True, exist_ok=True)
        jobs = []
        seen: set[str] = set()
        for path in sorted([*self.directory.glob("*.yaml"), *self.directory.glob("*.yml")]):
            raw = yaml.safe_load(path.read_text())
            if not isinstance(raw, dict):
                raise ValueError(f"{path}: job must be a YAML mapping")
            criteria = raw.get("acceptance_criteria")
            if not isinstance(criteria, list) or any(not isinstance(x, dict) for x in criteria):
                raise ValueError(f"{path}: acceptance_criteria must be a list of { '{id, description}' }")
            for item in criteria:
                if not item.get("id") or not item.get("description"):
                    raise ValueError(f"{path}: each acceptance criterion needs id and description")
            job = Job(str(raw.get("id", "")), str(raw.get("title", "")),
                      str(raw.get("description", "")), criteria,
                      str(raw.get("priority", "normal")), raw.get("workspace"))
            if not job.id or not job.title or not job.description:
                raise ValueError(f"{path}: id, title and description are required")
            if job.id in seen:
                raise ValueError(f"{path}: duplicate job id {job.id!r}")
            seen.add(job.id)
            jobs.append(job)
        return jobs


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class JobStore:
    """Additive job tables in the existing SSSF observability database."""
    def __init__(self, path: str | Path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
          acceptance_criteria_json TEXT NOT NULL, priority TEXT NOT NULL,
          workspace TEXT, source TEXT NOT NULL, source_identifier TEXT NOT NULL,
          state TEXT NOT NULL, previous_state TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
          current_adw_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          started_at TEXT, completed_at TEXT);
        CREATE TABLE IF NOT EXISTS job_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id),
          attempt INTEGER NOT NULL, adw_id TEXT UNIQUE, state TEXT NOT NULL,
          error TEXT, started_at TEXT NOT NULL, ended_at TEXT,
          UNIQUE(job_id, attempt));
        """)

    def sync(self, jobs: list[Job]) -> None:
        for j in jobs:
            ts = now()
            self.db.execute("""INSERT INTO jobs(id,title,description,acceptance_criteria_json,
              priority,workspace,source,source_identifier,state,created_at,updated_at)
              VALUES(?,?,?,?,?,?,'filesystem',?,'QUEUED',?,?) ON CONFLICT(id) DO NOTHING""",
              (j.id, j.title, j.description, __import__('json').dumps(j.acceptance_criteria),
               j.priority, j.workspace, j.id, ts, ts))

    def claim(self, max_attempts: int) -> sqlite3.Row | None:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT * FROM jobs WHERE state IN ('QUEUED','REWORK') "
                                  "AND attempt_count < ? ORDER BY CASE priority WHEN 'urgent' THEN 0 "
                                  "WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at, id LIMIT 1",
                                  (max_attempts,)).fetchone()
            if row:
                ts = now()
                attempt = row["attempt_count"] + 1
                self.db.execute("UPDATE jobs SET previous_state=state,state='CLAIMED',attempt_count=?,"
                                "started_at=COALESCE(started_at,?),updated_at=?,error=NULL WHERE id=?",
                                (attempt, ts, ts, row["id"]))
                self.db.execute("INSERT INTO job_attempts(job_id,attempt,state,started_at) VALUES(?,?,'CLAIMED',?)",
                                (row["id"], attempt, ts))
                row = self.db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
            self.db.execute("COMMIT")
            return row
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def transition(self, job_id: str, state: str, *, adw_id: str | None = None, error: str | None = None) -> None:
        if state not in STATES: raise ValueError(f"invalid job state: {state}")
        current = self.db.execute("SELECT state FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not current: raise KeyError(f"unknown job: {job_id}")
        if state != current[0] and state not in TRANSITIONS.get(current[0], set()):
            raise ValueError(f"invalid job transition: {current[0]} -> {state}")
        ts = now()
        self.db.execute("UPDATE jobs SET previous_state=state,state=?,current_adw_id=COALESCE(?,current_adw_id),"
                        "error=?,updated_at=?,completed_at=CASE WHEN ? IN ('COMPLETED','HUMAN_REQUIRED') THEN ? ELSE completed_at END WHERE id=?",
                        (state, adw_id, error, ts, state, ts, job_id))
        self.db.execute("UPDATE job_attempts SET state=?,adw_id=COALESCE(?,adw_id),error=?,"
                        "ended_at=CASE WHEN ? IN ('COMPLETED','REWORK','HUMAN_REQUIRED') THEN ? ELSE ended_at END "
                        "WHERE job_id=? AND attempt=(SELECT attempt_count FROM jobs WHERE id=?)",
                        (state, adw_id, error, state, ts, job_id, job_id))

    def recover(self, max_attempts: int) -> None:
        # A process exit during an attempt is retryable and remains auditable.
        self.db.execute("UPDATE jobs SET previous_state=state,state=CASE WHEN attempt_count>=? THEN 'HUMAN_REQUIRED' ELSE 'REWORK' END,error=COALESCE(error,'Factory stopped during attempt'),updated_at=? WHERE state IN ('CLAIMED','PLANNING','SCOUTING','BUILDING','TESTING','REVIEWING','DOCUMENTING')", (max_attempts, now()))
        self.db.execute("UPDATE job_attempts SET state=CASE WHEN (SELECT attempt_count FROM jobs WHERE jobs.id=job_attempts.job_id)>=? THEN 'HUMAN_REQUIRED' ELSE 'REWORK' END,error=COALESCE(error,'Factory stopped during attempt'),ended_at=? WHERE state IN ('CLAIMED','PLANNING','SCOUTING','BUILDING','TESTING','REVIEWING','DOCUMENTING')", (max_attempts, now()))

    def phase(self, adw_id: str) -> str | None:
        row = self.db.execute("SELECT name FROM phases WHERE adw_id=? AND status='running' ORDER BY seq DESC LIMIT 1", (adw_id,)).fetchone()
        return row[0] if row else None

    def failure_reason(self, adw_id: str) -> str | None:
        row = self.db.execute("SELECT payload_json FROM events WHERE adw_id=? AND type='error' ORDER BY rowid DESC LIMIT 1", (adw_id,)).fetchone()
        if not row or not row[0]: return None
        try:
            payload = __import__('json').loads(row[0])
            return str(payload.get("reason") or payload.get("error") or "workflow rejected")
        except (ValueError, AttributeError):
            return None


class Factory:
    def __init__(self, source: JobSource, store: JobStore, config: str, max_attempts: int = 3,
                 poll_seconds: float = 1.0):
        self.source, self.store, self.config = source, store, config
        self.max_attempts, self.poll_seconds = max_attempts, poll_seconds
        self.stopping = False

    def stop(self, *_): self.stopping = True

    def run_once(self) -> bool:
        self.store.sync(self.source.discover())
        row = self.store.claim(self.max_attempts)
        if row is None: return False
        from adw_modules.utils import new_id
        adw_id = new_id(8)
        self.store.transition(row["id"], "CLAIMED", adw_id=adw_id)
        prompt = f"{row['title']}\n\n{row['description']}\n\nAcceptance criteria:\n" + \
                 "\n".join(f"- {c['id']}: {c['description']}" for c in __import__('json').loads(row["acceptance_criteria_json"]))
        env = os.environ.copy()
        if row["workspace"]: env["SSSF_WORKSPACE"] = row["workspace"]
        proc = subprocess.Popen(["uv", "run", "adws/adw_simple_sdlc.py", "--config", self.config,
                                "--adw-id", adw_id, prompt], env=env)
        while proc.poll() is None and not self.stopping:
            phase = self.store.phase(adw_id)
            if phase:
                key = phase.split("_")[0]
                state = PHASE_STATE.get(key)
                if state: self.store.transition(row["id"], state, adw_id=adw_id)
            time.sleep(self.poll_seconds)
        if self.stopping and proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
            stopped_state = "HUMAN_REQUIRED" if row["attempt_count"] >= self.max_attempts else "REWORK"
            self.store.transition(row["id"], stopped_state, adw_id=adw_id, error="Factory stopped during attempt")
        elif proc.returncode == 0:
            self.store.transition(row["id"], "COMPLETED", adw_id=adw_id)
        else:
            reason = self.store.failure_reason(adw_id) or f"simple-sdlc exited with status {proc.returncode}"
            next_state = "REWORK" if row["attempt_count"] < self.max_attempts else "HUMAN_REQUIRED"
            self.store.transition(row["id"], next_state, adw_id=adw_id, error=reason)
        return True

    def run(self) -> None:
        self.store.recover(self.max_attempts)
        while not self.stopping:
            if not self.run_once(): time.sleep(self.poll_seconds)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    p.add_argument("--jobs", default=os.getenv("SSSF_JOBS_DIR", "jobs"))
    p.add_argument("--max-attempts", type=int, default=int(os.getenv("SSSF_MAX_ATTEMPTS", "3")))
    p.add_argument("--poll-seconds", type=float, default=float(os.getenv("SSSF_POLL_SECONDS", "2")))
    args = p.parse_args()
    cfg = yaml.safe_load(Path(args.config).read_text())
    db_path = cfg.get("observability", {}).get("db", "adws/adw_data/sssf.db")
    # Ensure the canonical SSSF tables exist even on a first-ever factory run.
    from adw_modules.tracer import Tracer
    tracer = Tracer(db_path, Path(cfg.get("defaults", {}).get("data_dir", "adws/adw_data")) /
                    "sessions/factory/events.jsonl")
    tracer.conn.close()
    store = JobStore(db_path)
    factory = Factory(FilesystemJobSource(args.jobs), store, args.config,
                      args.max_attempts, args.poll_seconds)
    signal.signal(signal.SIGINT, factory.stop)
    signal.signal(signal.SIGTERM, factory.stop)
    try: factory.run()
    finally: store.db.close()
    return 0


if __name__ == "__main__": sys.exit(main())
