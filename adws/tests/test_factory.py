import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adw_factory import FilesystemJobSource, JobStore


class FactoryStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = JobStore(self.root / "sssf.db")

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_discovers_and_validates_structured_jobs(self):
        jobs_dir = self.root / "jobs"
        jobs_dir.mkdir()
        (jobs_dir / "A.yaml").write_text("""id: A\ntitle: Example\ndescription: Do a thing\nacceptance_criteria:\n  - id: AC1\n    description: It works\n""")
        jobs = FilesystemJobSource(jobs_dir).discover()
        self.assertEqual(jobs[0].acceptance_criteria[0]["id"], "AC1")
        (jobs_dir / "B.yaml").write_text("id: B\ntitle: Broken\ndescription: no criteria\n")
        with self.assertRaisesRegex(ValueError, "acceptance_criteria"):
            FilesystemJobSource(jobs_dir).discover()

    def test_claim_attempt_retry_escalation_and_restart_persistence(self):
        jobs = self.root / "jobs"
        jobs.mkdir()
        (jobs / "A.yaml").write_text("""id: A\ntitle: Example\ndescription: Do a thing\nacceptance_criteria:\n  - id: AC1\n    description: It works\n""")
        self.store.sync(FilesystemJobSource(jobs).discover())
        row = self.store.claim(2)
        self.assertEqual((row["state"], row["attempt_count"]), ("CLAIMED", 1))
        self.store.transition("A", "REWORK", error="tests failed")
        row = self.store.claim(2)
        self.assertEqual(row["attempt_count"], 2)
        self.store.transition("A", "HUMAN_REQUIRED", error="still failing")
        self.assertIsNone(self.store.claim(2))
        self.store.db.close()
        self.store = JobStore(self.root / "sssf.db")
        row = self.store.db.execute("SELECT state,attempt_count,error FROM jobs WHERE id='A'").fetchone()
        self.assertEqual(tuple(row), ("HUMAN_REQUIRED", 2, "still failing"))

    def test_recovery_returns_interrupted_attempt_to_rework(self):
        self.store.db.execute("INSERT INTO jobs(id,title,description,acceptance_criteria_json,priority,source,source_identifier,state,created_at,updated_at) VALUES('A','A','d','[]','normal','filesystem','A','BUILDING','t','t')")
        self.store.db.execute("INSERT INTO job_attempts(job_id,attempt,state,started_at) VALUES('A',1,'BUILDING','t')")
        self.store.recover(3)
        self.assertEqual(self.store.db.execute("SELECT state FROM jobs WHERE id='A'").fetchone()[0], "REWORK")

    def test_completed_job_is_never_claimed_again(self):
        self.store.db.execute("INSERT INTO jobs(id,title,description,acceptance_criteria_json,priority,source,source_identifier,state,attempt_count,created_at,updated_at) VALUES('A','A','d','[]','normal','filesystem','A','COMPLETED',1,'t','t')")
        self.assertIsNone(self.store.claim(3))

    def test_rejects_invalid_state_transition(self):
        self.store.db.execute("INSERT INTO jobs(id,title,description,acceptance_criteria_json,priority,source,source_identifier,state,created_at,updated_at) VALUES('A','A','d','[]','normal','filesystem','A','QUEUED','t','t')")
        with self.assertRaisesRegex(ValueError, "QUEUED -> COMPLETED"):
            self.store.transition("A", "COMPLETED")


if __name__ == "__main__":
    unittest.main()
