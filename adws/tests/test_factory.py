"""Tests for the persistent local software factory.

Everything here is deterministic and offline: the SDLC pipeline is replaced by
a controllable fake process, so no live agents or API credentials are needed.
The one opt-in end-to-end test is skipped unless SSSF_FACTORY_E2E=1.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adw_factory import (ACTIVE, TRANSITIONS, Factory, FilesystemJobSource,
                         Job, JobStore, build_prompt, main, parse_args,
                         state_for_phase)
from adw_modules.tracer import Tracer

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = REPO_ROOT / "examples" / "jobs"


def _job_yaml(job_id="A", title="Example", description="Do a thing",
              criteria=(("AC1", "It works"),), priority=None, workspace=None):
    lines = [f"id: {job_id}", f"title: {title}", f"description: {description}"]
    if priority is not None:
        lines.append(f"priority: {priority}")
    if workspace is not None:
        lines.append(f"workspace: {workspace}")
    lines.append("acceptance_criteria:")
    for criterion_id, criterion_description in criteria:
        lines.append(f"  - id: {criterion_id}")
        lines.append(f"    description: {criterion_description}")
    return "\n".join(lines) + "\n"


def write_job(directory: Path, name: str, **kwargs) -> Path:
    path = Path(directory) / name
    path.write_text(_job_yaml(**kwargs))
    return path


def _insert_job(store: JobStore, job_id: str, *, state="QUEUED", attempt_count=0,
                priority="normal", created_at="2024-01-01T00:00:00+00:00",
                error=None, adw_id=None):
    store.db.execute(
        "INSERT INTO jobs(id,title,description,acceptance_criteria_json,priority,source,"
        "source_identifier,state,previous_state,attempt_count,current_adw_id,error,"
        "created_at,updated_at) VALUES(?,?,?,?,?,'filesystem',?,?,?,?,?,?,?,?)",
        (job_id, job_id, "d", "[]", priority, job_id, state, state, attempt_count,
         adw_id, error, created_at, created_at))


def _insert_attempt(store: JobStore, job_id: str, attempt: int, state="CLAIMED",
                    adw_id=None):
    store.db.execute(
        "INSERT INTO job_attempts(job_id,attempt,state,adw_id,started_at) "
        "VALUES(?,?,?,?,?)",
        (job_id, attempt, state, adw_id, "2024-01-01T00:00:00+00:00"))


class JobParsingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_job_with_defaults(self):
        write_job(self.dir, "A.yaml", job_id="A", criteria=(("AC1", "It works"),))
        job = FilesystemJobSource(self.dir).discover()[0]
        self.assertEqual(job.id, "A")
        self.assertEqual(job.title, "Example")
        self.assertEqual(job.priority, "normal")
        self.assertEqual(job.acceptance_criteria, [{"id": "AC1", "description": "It works"}])
        self.assertEqual(job.source, "filesystem")
        self.assertEqual(job.source_identifier, str(self.dir / "A.yaml"))

    def test_priority_and_workspace_are_kept(self):
        write_job(self.dir, "A.yaml", priority="urgent", workspace="worktrees/a")
        job = FilesystemJobSource(self.dir).discover()[0]
        self.assertEqual(job.priority, "urgent")
        self.assertEqual(job.workspace, "worktrees/a")

    def test_yml_extension_is_discovered(self):
        write_job(self.dir, "A.yml", job_id="A")
        self.assertEqual([j.id for j in FilesystemJobSource(self.dir).discover()], ["A"])

    def test_missing_directory_is_empty_queue(self):
        self.assertEqual(FilesystemJobSource(self.dir / "nope").discover(), [])

    def test_empty_directory_is_empty_queue(self):
        self.assertEqual(FilesystemJobSource(self.dir).discover(), [])

    def test_malformed_yaml_is_rejected(self):
        (self.dir / "A.yaml").write_text("id: [unterminated\n")
        with self.assertRaisesRegex(ValueError, "invalid YAML"):
            FilesystemJobSource(self.dir).discover()

    def test_non_mapping_root_is_rejected(self):
        (self.dir / "A.yaml").write_text("- one\n- two\n")
        with self.assertRaisesRegex(ValueError, "YAML mapping"):
            FilesystemJobSource(self.dir).discover()

    def test_missing_required_fields_are_rejected(self):
        for field_name, body in (
            ("id", _job_yaml().replace("id: A\n", "")),
            ("title", _job_yaml(title="")),
            ("description", _job_yaml(description="   ")),
        ):
            with self.subTest(field=field_name):
                (self.dir / "A.yaml").write_text(body)
                with self.assertRaisesRegex(ValueError, field_name):
                    FilesystemJobSource(self.dir).discover()

    def test_empty_criteria_is_rejected(self):
        (self.dir / "A.yaml").write_text("id: A\ntitle: T\ndescription: D\nacceptance_criteria: []\n")
        with self.assertRaisesRegex(ValueError, "acceptance_criteria"):
            FilesystemJobSource(self.dir).discover()

    def test_missing_criteria_is_rejected(self):
        (self.dir / "A.yaml").write_text("id: A\ntitle: T\ndescription: D\n")
        with self.assertRaisesRegex(ValueError, "acceptance_criteria"):
            FilesystemJobSource(self.dir).discover()

    def test_criteria_item_must_be_mapping(self):
        (self.dir / "A.yaml").write_text(
            "id: A\ntitle: T\ndescription: D\nacceptance_criteria:\n  - just a string\n")
        with self.assertRaisesRegex(ValueError, "mapping"):
            FilesystemJobSource(self.dir).discover()

    def test_criterion_without_description_is_rejected(self):
        (self.dir / "A.yaml").write_text(
            "id: A\ntitle: T\ndescription: D\nacceptance_criteria:\n  - id: AC1\n")
        with self.assertRaisesRegex(ValueError, "description"):
            FilesystemJobSource(self.dir).discover()

    def test_duplicate_criteria_ids_are_rejected(self):
        write_job(self.dir, "A.yaml", criteria=(("AC1", "one"), ("AC1", "two")))
        with self.assertRaisesRegex(ValueError, "duplicate acceptance criterion"):
            FilesystemJobSource(self.dir).discover()

    def test_invalid_priority_is_rejected(self):
        write_job(self.dir, "A.yaml", priority="someday")
        with self.assertRaisesRegex(ValueError, "priority"):
            FilesystemJobSource(self.dir).discover()

    def test_duplicate_ids_across_files_are_rejected(self):
        write_job(self.dir, "A.yaml", job_id="SAME")
        write_job(self.dir, "B.yaml", job_id="SAME")
        with self.assertRaisesRegex(ValueError, "duplicate job id"):
            FilesystemJobSource(self.dir).discover()

    def test_source_files_are_left_in_place(self):
        path = write_job(self.dir, "A.yaml", job_id="A")
        FilesystemJobSource(self.dir).discover()
        self.assertTrue(path.is_file())
        self.assertEqual(path.read_text(), _job_yaml(job_id="A"))


class StateMappingTests(unittest.TestCase):
    def test_phase_names_map_to_states(self):
        self.assertEqual(state_for_phase("plan"), "PLANNING")
        self.assertEqual(state_for_phase("test_2"), "TESTING")
        self.assertEqual(state_for_phase("fix_1"), "BUILDING")
        self.assertEqual(state_for_phase("retest"), "TESTING")
        self.assertEqual(state_for_phase("revise_1"), "BUILDING")
        self.assertEqual(state_for_phase("review_1"), "REVIEWING")
        self.assertEqual(state_for_phase("document"), "DOCUMENTING")
        self.assertEqual(state_for_phase("scout"), "SCOUTING")

    def test_bookkeeping_phases_are_unmapped(self):
        for name in ("request", "commit_plan", "commit_build", "changes",
                     "commit_docs", None, ""):
            with self.subTest(name=name):
                self.assertIsNone(state_for_phase(name))

    def test_any_active_state_can_reach_any_active_state(self):
        for source in ACTIVE:
            for target in ACTIVE:
                with self.subTest(source=source, target=target):
                    self.assertIn(target, TRANSITIONS[source])

    def test_claiming_is_only_from_queued_or_rework(self):
        self.assertEqual(TRANSITIONS["QUEUED"], {"CLAIMED"})
        self.assertEqual(TRANSITIONS["REWORK"], {"CLAIMED"})

    def test_terminal_states_are_absorbing(self):
        for state in ("COMPLETED", "FAILED", "HUMAN_REQUIRED"):
            self.assertNotIn(state, TRANSITIONS)


class JobStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = JobStore(self.root / "sssf.db")

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_sync_inserts_queued_job_with_structured_criteria(self):
        job = Job("A", "Title", "Desc", [{"id": "AC1", "description": "works"}])
        self.store.sync([job])
        row = self.store.get("A")
        self.assertEqual(row["state"], "QUEUED")
        self.assertEqual(json.loads(row["acceptance_criteria_json"]),
                         [{"id": "AC1", "description": "works"}])

    def test_sync_does_not_overwrite_existing_record(self):
        self.store.sync([Job("A", "First", "Desc", [{"id": "AC1", "description": "works"}])])
        row = self.store.claim(3)
        self.store.transition("A", "REWORK", error="failed")
        # The source definition changes, but history must not.
        self.store.sync([Job("A", "Second", "Other", [{"id": "AC9", "description": "x"}])])
        row = self.store.get("A")
        self.assertEqual(row["title"], "First")
        self.assertEqual(row["state"], "REWORK")
        self.assertEqual(row["error"], "failed")

    def test_claim_increments_attempt_and_opens_attempt_row(self):
        _insert_job(self.store, "A")
        row = self.store.claim(3)
        self.assertEqual((row["state"], row["attempt_count"]), ("CLAIMED", 1))
        self.assertIsNone(self.store.claim(3))
        attempts = self.store.attempts("A")
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0]["attempt"], 1)
        self.assertEqual(attempts[0]["state"], "CLAIMED")

    def test_claim_orders_by_priority_then_created_at(self):
        _insert_job(self.store, "low", priority="low", created_at="2024-01-01")
        _insert_job(self.store, "urgent", priority="urgent", created_at="2024-06-01")
        _insert_job(self.store, "high", priority="high", created_at="2024-03-01")
        self.assertEqual(self.store.claim(3)["id"], "urgent")
        self.assertEqual(self.store.claim(3)["id"], "high")
        self.assertEqual(self.store.claim(3)["id"], "low")

    def test_claim_respects_attempt_bound(self):
        _insert_job(self.store, "A", state="REWORK", attempt_count=2)
        self.assertIsNone(self.store.claim(2))
        self.assertEqual(self.store.claim(3)["id"], "A")

    def test_completed_and_human_required_are_never_claimed(self):
        _insert_job(self.store, "done", state="COMPLETED", attempt_count=1)
        _insert_job(self.store, "human", state="HUMAN_REQUIRED", attempt_count=3)
        self.assertIsNone(self.store.claim(5))

    def test_failed_is_terminal_and_not_claimed(self):
        _insert_job(self.store, "A")
        self.store.transition("A", "CLAIMED")
        self.store.transition("A", "FAILED", error="not retryable")
        self.assertIsNone(self.store.claim(5))
        with self.assertRaisesRegex(ValueError, "FAILED -> COMPLETED"):
            self.store.transition("A", "COMPLETED")

    def test_legal_transition_persists_previous_state_and_reason(self):
        _insert_job(self.store, "A")
        self.store.claim(3)
        self.store.transition("A", "BUILDING", adw_id="run1")
        row = self.store.get("A")
        self.assertEqual(row["state"], "BUILDING")
        self.assertEqual(row["previous_state"], "CLAIMED")
        self.assertEqual(row["current_adw_id"], "run1")
        self.store.transition("A", "REWORK", error="tests failed")
        row = self.store.get("A")
        self.assertEqual((row["state"], row["error"]), ("REWORK", "tests failed"))

    def test_illegal_transition_is_rejected(self):
        _insert_job(self.store, "A")
        with self.assertRaisesRegex(ValueError, "QUEUED -> COMPLETED"):
            self.store.transition("A", "COMPLETED")
        self.assertEqual(self.store.get("A")["state"], "QUEUED")

    def test_invalid_state_and_unknown_job_are_rejected(self):
        _insert_job(self.store, "A")
        with self.assertRaisesRegex(ValueError, "invalid job state"):
            self.store.transition("A", "NOT_A_STATE")
        with self.assertRaisesRegex(KeyError, "unknown job"):
            self.store.transition("missing", "CLAIMED")

    def test_attempt_records_run_id_and_end_time(self):
        _insert_job(self.store, "A")
        self.store.claim(3)
        self.store.transition("A", "CLAIMED", adw_id="run9")
        self.store.transition("A", "BUILDING", adw_id="run9")
        self.store.transition("A", "REWORK", adw_id="run9", error="boom")
        attempt = self.store.attempts("A")[0]
        self.assertEqual(attempt["adw_id"], "run9")
        self.assertEqual((attempt["state"], attempt["error"]), ("REWORK", "boom"))
        self.assertIsNotNone(attempt["ended_at"])

    def test_state_survives_close_and_reopen(self):
        _insert_job(self.store, "A")
        self.store.claim(2)
        self.store.transition("A", "REWORK", error="tests failed")
        self.store.db.close()
        self.store = JobStore(self.root / "sssf.db")
        row = self.store.get("A")
        self.assertEqual((row["state"], row["attempt_count"], row["error"]),
                         ("REWORK", 1, "tests failed"))

    def test_recovery_moves_every_active_state_to_rework(self):
        for i, state in enumerate(sorted(ACTIVE)):
            _insert_job(self.store, f"J{i}", state=state, attempt_count=1)
            _insert_attempt(self.store, f"J{i}", 1, state=state)
        self.store.recover(3)
        for i in range(len(ACTIVE)):
            row = self.store.get(f"J{i}")
            self.assertEqual(row["state"], "REWORK")
            self.assertEqual(row["error"], "Factory stopped during attempt")
            attempt = self.store.attempts(f"J{i}")[0]
            self.assertEqual(attempt["state"], "REWORK")
            self.assertIsNotNone(attempt["ended_at"])

    def test_recovery_at_attempt_ceiling_escalates(self):
        _insert_job(self.store, "A", state="BUILDING", attempt_count=3)
        _insert_attempt(self.store, "A", 3, state="BUILDING")
        self.store.recover(3)
        self.assertEqual(self.store.get("A")["state"], "HUMAN_REQUIRED")

    def test_recovery_is_idempotent(self):
        _insert_job(self.store, "A", state="TESTING", attempt_count=1)
        _insert_attempt(self.store, "A", 1, state="TESTING")
        self.store.recover(3)
        first = dict(self.store.get("A"))
        self.store.recover(3)
        second = dict(self.store.get("A"))
        self.assertEqual(first["state"], second["state"])
        self.assertEqual(first["updated_at"], second["updated_at"])

    def test_phase_and_failure_reason_tolerate_missing_tracer_schema(self):
        self.assertIsNone(self.store.phase("run1"))
        self.assertIsNone(self.store.failure_reason("run1"))


class _FakeProcess:
    """A deterministic stand-in for subprocess.Popen."""

    def __init__(self, codes=(None, 0), on_poll=None):
        self._codes = list(codes)
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False
        self.polls = 0
        self.on_poll = on_poll

    def poll(self):
        if self.returncode is not None:
            return self.returncode
        n = self.polls
        self.polls += 1
        if self.on_poll:
            self.on_poll(n)
        code = self._codes.pop(0) if self._codes else None
        if code is not None:
            self.returncode = code
        return self.returncode

    def wait(self, timeout=None):
        if self.returncode is None:
            code = self._codes.pop(0) if self._codes else 0
            self.returncode = code if code is not None else 0
        return self.returncode

    def terminate(self):
        self.terminated = True
        if self.returncode is None:
            self.returncode = -signal.SIGTERM

    def kill(self):
        self.killed = True
        self.returncode = -signal.SIGKILL


class _HangingProcess(_FakeProcess):
    """Terminate never completes; only kill does — exercises timeout escalation."""

    def __init__(self, on_poll=None):
        super().__init__(codes=(), on_poll=on_poll)

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        if self.returncode is None:
            raise subprocess.TimeoutExpired("fake", timeout or 0)
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -signal.SIGKILL


class _FakeRunner:
    def __init__(self, process):
        self.process = process
        self.calls: list[dict] = []

    def launch(self, *, adw_id, prompt, config, env):
        self.calls.append({"adw_id": adw_id, "prompt": prompt, "config": config, "env": env})
        return self.process


class _RaisingRunner:
    def launch(self, **kwargs):
        raise OSError("uv not found")


class WorkerTests(unittest.TestCase):
    MAX_ATTEMPTS = 3

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / "sssf.db"
        Tracer(self.db_path, self.root / "events.jsonl").conn.close()
        self.store = JobStore(self.db_path)
        self.jobs = self.root / "jobs"
        self.jobs.mkdir()
        write_job(self.jobs, "A.yaml", job_id="A")

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def _factory(self, runner, max_attempts=None):
        return Factory(FilesystemJobSource(self.jobs), self.store, "cfg.yaml",
                       max_attempts if max_attempts is not None else self.MAX_ATTEMPTS,
                       poll_seconds=0, runner=runner,
                       id_factory=lambda: "adwtest", shutdown_timeout=1)

    def _insert_phase(self, name, seq=1, status="running"):
        self.store.db.execute(
            "INSERT INTO phases(phase_id,adw_id,seq,name,kind,owner,status,started_at) "
            "VALUES(?,?,?,?,'agent','tester',?,?)",
            (f"ph_{name}", "adwtest", seq, name, status, "2024-01-01"))

    def _insert_error(self, reason, event_type="error"):
        self.store.db.execute(
            "INSERT INTO events(event_id,adw_id,type,name,payload_json,started_at) "
            "VALUES(?,?,?,?,?,?)",
            (f"evt_{reason}", "adwtest", event_type, "not_accepted",
             json.dumps({"reason": reason}), "2024-01-01"))

    def test_idle_when_no_jobs(self):
        empty = self.root / "empty"
        empty.mkdir()
        factory = Factory(FilesystemJobSource(empty), self.store, "cfg.yaml",
                          poll_seconds=0, runner=_FakeRunner(_FakeProcess()))
        self.assertFalse(factory.run_once())

    def test_successful_completion(self):
        process = _FakeProcess(codes=(None, 0))
        factory = self._factory(_FakeRunner(process))
        self.assertTrue(factory.run_once())
        row = self.store.get("A")
        self.assertEqual((row["state"], row["attempt_count"]), ("COMPLETED", 1))
        self.assertEqual(row["current_adw_id"], "adwtest")
        self.assertEqual(self.store.attempts("A")[0]["state"], "COMPLETED")

    def test_prompt_carries_every_structured_criterion(self):
        write_job(self.jobs, "A.yaml", job_id="A",
                  criteria=(("AC1", "first"), ("AC2", "second")))
        runner = _FakeRunner(_FakeProcess(codes=(None, 0)))
        self._factory(runner).run_once()
        prompt = runner.calls[0]["prompt"]
        self.assertIn("AC1: first", prompt)
        self.assertIn("AC2: second", prompt)

    def test_failure_records_traced_reason_and_reworks(self):
        self._insert_error("reviewer rejected the change")
        factory = self._factory(_FakeRunner(_FakeProcess(codes=(None, 1))))
        factory.run_once()
        row = self.store.get("A")
        self.assertEqual(row["state"], "REWORK")
        self.assertEqual(row["error"], "reviewer rejected the change")
        self.assertEqual(self.store.attempts("A")[0]["error"],
                         "reviewer rejected the change")

    def test_failure_without_trace_uses_exit_status(self):
        factory = self._factory(_FakeRunner(_FakeProcess(codes=(None, 2))))
        factory.run_once()
        self.assertEqual(self.store.get("A")["error"], "simple-sdlc exited with status 2")

    def test_retry_exhaustion_escalates_to_human_required(self):
        factory = self._factory(_FakeRunner(_FakeProcess(codes=(None, 1))), max_attempts=1)
        factory.run_once()
        self.assertEqual(self.store.get("A")["state"], "HUMAN_REQUIRED")

    def test_phase_polling_updates_state(self):
        observed = []

        def on_poll(n):
            if n == 0:
                self._insert_phase("build", seq=1)
            if n == 1:
                observed.append(self.store.get("A")["state"])

        process = _FakeProcess(codes=(None, None, 0), on_poll=on_poll)
        self._factory(_FakeRunner(process)).run_once()
        self.assertEqual(observed, ["BUILDING"])
        self.assertEqual(self.store.get("A")["state"], "COMPLETED")

    def test_rapid_phase_skips_are_recorded_not_fatal(self):
        # CLAIMED observes TESTING directly; the broad legal map must accept it.
        self._insert_phase("test_1", seq=1)
        factory = self._factory(_FakeRunner(_FakeProcess(codes=(None, 0))))
        factory.run_once()
        self.assertEqual(self.store.get("A")["state"], "COMPLETED")

    def test_unlaunchable_workflow_fails_without_retry(self):
        factory = self._factory(_RaisingRunner())
        factory.run_once()
        row = self.store.get("A")
        self.assertEqual(row["state"], "FAILED")
        self.assertIn("could not launch workflow", row["error"])

    def test_shutdown_interrupts_running_workflow_and_reworks(self):
        factory = None

        def on_poll(n):
            if n == 2:
                factory.stop()

        process = _FakeProcess(codes=(), on_poll=on_poll)
        factory = self._factory(_FakeRunner(process))
        factory.run_once()
        row = self.store.get("A")
        self.assertEqual(row["state"], "REWORK")
        self.assertEqual(row["error"], "Factory stopped during attempt")
        self.assertTrue(process.terminated)

    def test_shutdown_at_attempt_ceiling_escalates(self):
        factory = None

        def on_poll(n):
            if n == 2:
                factory.stop()

        process = _FakeProcess(codes=(), on_poll=on_poll)
        factory = self._factory(_FakeRunner(process), max_attempts=1)
        factory.run_once()
        self.assertEqual(self.store.get("A")["state"], "HUMAN_REQUIRED")

    def test_shutdown_timeout_kills_workflow(self):
        factory = None

        def on_poll(n):
            if n == 2:
                factory.stop()

        process = _HangingProcess(on_poll=on_poll)
        factory = self._factory(_FakeRunner(process))
        factory.run_once()
        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)
        self.assertEqual(self.store.get("A")["state"], "REWORK")

    def test_completed_job_is_not_processed_again(self):
        self.store.sync(FilesystemJobSource(self.jobs).discover())
        self.store.claim(3)
        self.store.transition("A", "COMPLETED")
        runner = _FakeRunner(_FakeProcess())
        self.assertFalse(self._factory(runner).run_once())
        self.assertEqual(runner.calls, [])

    def test_run_recovers_interrupted_job_then_processes_it(self):
        _insert_job(self.store, "B", state="BUILDING", attempt_count=1)
        _insert_attempt(self.store, "B", 1, state="BUILDING")
        write_job(self.jobs, "B.yaml", job_id="B")
        factory = self._factory(_FakeRunner(_FakeProcess(codes=(None, 0))))
        factory.run(once=True)
        self.assertEqual(self.store.get("B")["state"], "COMPLETED")

    def test_new_definition_is_discovered_after_poll(self):
        runner = _FakeRunner(_FakeProcess(codes=(None, 0)))
        factory = self._factory(runner)
        factory.run_once()  # processes A
        write_job(self.jobs, "C.yaml", job_id="C")
        self.assertTrue(factory.run_once())  # discovers and processes C
        self.assertEqual(self.store.get("C")["state"], "COMPLETED")

    def test_invalid_definition_is_reported_and_skipped(self):
        (self.jobs / "bad.yaml").write_text("id: BAD\ntitle: x\ndescription: y\n")
        import contextlib
        import io
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertFalse(self._factory(_FakeRunner(_FakeProcess())).run_once())
        self.assertIn("acceptance_criteria", stderr.getvalue())


class BuildPromptTests(unittest.TestCase):
    def test_prompt_includes_title_description_and_criteria(self):
        row = {"title": "Title", "description": "Desc",
               "acceptance_criteria_json": json.dumps(
                   [{"id": "AC1", "description": "one"}, {"id": "AC2", "description": "two"}])}
        prompt = build_prompt(row)
        self.assertIn("Title", prompt)
        self.assertIn("Desc", prompt)
        self.assertIn("- AC1: one", prompt)
        self.assertIn("- AC2: two", prompt)


class ConfigTests(unittest.TestCase):
    def test_defaults(self):
        args = parse_args([])
        self.assertEqual(args.max_attempts, 3)
        self.assertFalse(args.once)

    def test_invalid_max_attempts_is_rejected(self):
        self.assertEqual(main(["--max-attempts", "0"]), 2)

    def test_invalid_poll_seconds_is_rejected(self):
        self.assertEqual(main(["--poll-seconds", "0"]), 2)

    def test_missing_config_is_rejected(self):
        self.assertEqual(main(["--config", "/nonexistent/config.yaml"]), 2)


class ExampleJobTests(unittest.TestCase):
    def test_two_examples_validate_and_stay_on_disk(self):
        source = FilesystemJobSource(EXAMPLES_DIR)
        jobs = source.discover()
        self.assertEqual({job.id for job in jobs}, {"EXAMPLE-001", "EXAMPLE-002"})
        for job in jobs:
            self.assertTrue(job.acceptance_criteria)
            self.assertTrue(all(c["id"] and c["description"]
                                for c in job.acceptance_criteria))
        self.assertTrue((EXAMPLES_DIR / "EXAMPLE-001.yaml").is_file())
        self.assertTrue((EXAMPLES_DIR / "EXAMPLE-002.yaml").is_file())

    @unittest.skipUnless(
        os.getenv("SSSF_FACTORY_E2E") == "1" and shutil.which("just"),
        "opt-in: set SSSF_FACTORY_E2E=1 with agent credentials to run the live smoke")
    def test_examples_run_through_the_real_pipeline(self):
        result = subprocess.run(
            ["just", "factory", "--", "--jobs", "examples/jobs",
             "--max-attempts", "1", "--once"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=1800)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
