<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { hrefFor } from '../lib/router'
import type { FactoryJob } from '../lib/types'

const jobs = ref<FactoryJob[]>([])
const error = ref('')
let timer: ReturnType<typeof setInterval> | undefined

async function tick() {
  try {
    const response = await fetch('/api/jobs')
    if (!response.ok) throw new Error(`GET /api/jobs → ${response.status}`)
    jobs.value = await response.json() as FactoryJob[]
    error.value = ''
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}

const QUEUED = new Set<string>(['QUEUED', 'REWORK'])
const IN_PROGRESS = new Set<string>(['CLAIMED', 'PLANNING', 'SCOUTING', 'BUILDING', 'TESTING', 'REVIEWING', 'DOCUMENTING'])
const ATTENTION = new Set<string>(['FAILED', 'HUMAN_REQUIRED'])

const columns = computed(() => [
  { name: 'QUEUED', jobs: jobs.value.filter(j => QUEUED.has(j.state)) },
  { name: 'IN PROGRESS', jobs: jobs.value.filter(j => IN_PROGRESS.has(j.state)) },
  { name: 'COMPLETED', jobs: jobs.value.filter(j => j.state === 'COMPLETED') },
  { name: 'NEEDS ATTENTION', jobs: jobs.value.filter(j => ATTENTION.has(j.state)) },
])

/** Parse the stored criteria JSON safely — a bad row must not break the board. */
function criteria(job: FactoryJob): { id: string; description: string }[] {
  try {
    const parsed = JSON.parse(job.acceptance_criteria_json || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

onMounted(() => { void tick(); timer = setInterval(() => void tick(), 1500) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="factory-board">
    <div v-if="error" class="error-bar">factory data unavailable — {{ error }}</div>
    <div class="board-columns">
      <section v-for="column in columns" :key="column.name" class="board-column">
        <h2>{{ column.name }} <span>{{ column.jobs.length }}</span></h2>
        <article v-for="job in column.jobs" :key="job.id" class="job-card">
          <div class="job-heading"><strong>{{ job.id }}</strong><span>{{ job.state }}</span></div>
          <div class="job-title">{{ job.title }}</div>
          <div class="job-meta">
            <span>Attempt {{ job.attempt_count }}</span>
            <span v-if="job.priority">· {{ job.priority }}</span>
            <span v-if="job.source_identifier">· {{ job.source_identifier }}</span>
          </div>
          <ul v-if="criteria(job).length" class="job-criteria">
            <li v-for="criterion in criteria(job)" :key="criterion.id">
              <strong>{{ criterion.id }}</strong> {{ criterion.description }}
            </li>
          </ul>
          <p v-if="job.error" class="job-error">{{ job.error }}</p>
          <a v-if="job.current_adw_id" :href="hrefFor(job.current_adw_id)">Open SSSF run ↗</a>
        </article>
        <p v-if="!column.jobs.length" class="empty-column">No jobs</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.factory-board { padding: 20px 24px; }
.board-columns { display: grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 14px; }
.board-column { min-width: 0; }
.board-column h2 { color: var(--dim); font-size: 12px; letter-spacing: .12em; margin: 0 0 10px; }
.board-column h2 span { float: right; color: var(--faint); }
.job-card { background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 13px; margin-bottom: 9px; color: var(--text); }
.job-heading { display:flex; justify-content:space-between; color: var(--cyan); font-size: 12px; margin-bottom:8px; }
.job-heading span, .job-meta { color: var(--dim); font-size: 11px; }
.job-title { font-size: 13px; margin-bottom: 6px; }
.job-meta { display: flex; gap: 5px; flex-wrap: wrap; }
.job-criteria { list-style: none; margin: 8px 0 0; padding: 0; font-size: 11px; color: var(--dim); }
.job-criteria li { margin-top: 3px; }
.job-criteria strong { color: var(--faint); margin-right: 4px; }
.job-card a { display:inline-block; margin-top:9px; color:var(--purple); font-size:12px; }
.job-error { color:#fb7185; font-size:12px; word-break: break-word; }
.empty-column { color:var(--faint); font-size:13px; }
</style>
