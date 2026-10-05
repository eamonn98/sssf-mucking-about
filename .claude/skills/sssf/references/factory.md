# Local software factory

`just factory` runs the single-worker local factory. It reads YAML jobs from
`jobs/` (or `SSSF_JOBS_DIR`), records each job and attempt in the configured
SSSF observability database, and runs the existing `adw_simple_sdlc.py`
pipeline once per attempt. Job definition files are never moved or deleted.

The default retry limit is three attempts. Set `SSSF_MAX_ATTEMPTS` to change
it. `SSSF_POLL_SECONDS` controls how often the worker checks for newly added
jobs. Ctrl-C or SIGTERM stops the active workflow cleanly; an interrupted job
is retried after the next factory start, subject to its attempt limit.

Job IDs are stable and unique in the database. The first discovered YAML file
creates its database record; later edits to that file do not overwrite job
history. Use a new ID for a new job. The two starter definitions are in
`examples/jobs/`; process them explicitly with
`SSSF_JOBS_DIR=examples/jobs just factory`.

The visualizer's **factory** view reads `/api/jobs` from the same SQLite
database and links each attempt to its SSSF run. `just obs` starts the existing
visualizer as before.

The initial worker uses one process at a time and the filesystem is the only
job source. GitHub/Jira/Linear adapters, automated PR actions, parallel
workers, and automated acceptance-criteria evaluation are future work.
