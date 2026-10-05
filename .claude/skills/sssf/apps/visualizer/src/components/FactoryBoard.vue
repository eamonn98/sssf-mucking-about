<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { hrefFor } from '../lib/router'

interface FactoryJob {
  id: string; title: string; state: string; attempt_count: number
  current_adw_id: string | null; error: string | null; updated_at: string
}
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
const columns = computed(() => [
  { name: 'QUEUED', jobs: jobs.value.filter(j => ['QUEUED','REWORK'].includes(j.state)) },
  { name: 'IN PROGRESS', jobs: jobs.value.filter(j => ['CLAIMED','PLANNING','SCOUTING','BUILDING','TESTING','REVIEWING','DOCUMENTING'].includes(j.state)) },
  { name: 'COMPLETED', jobs: jobs.value.filter(j => j.state === 'COMPLETED') },
  { name: 'NEEDS ATTENTION', jobs: jobs.value.filter(j => ['FAILED','HUMAN_REQUIRED'].includes(j.state)) },
])
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
          <div>{{ job.title }}</div>
          <small>Attempt {{ job.attempt_count }}</small>
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
.job-heading span, .job-card small { color: var(--dim); font-size: 11px; }
.job-card small { display:block; margin-top:8px; }
.job-card a { display:inline-block; margin-top:9px; color:var(--purple); font-size:12px; }
.job-error { color:#fb7185; font-size:12px; }
.empty-column { color:var(--faint); font-size:13px; }
</style>
