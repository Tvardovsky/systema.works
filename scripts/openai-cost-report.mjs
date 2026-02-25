#!/usr/bin/env node

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error("OPENAI_API_KEY is required")
  process.exit(1)
}

const baseUrl = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1"
const projectId = process.env.OPENAI_PROJECT_ID ?? ""
const today = new Date()
const end = formatDate(today)
const start = formatDate(new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000))

async function callOpenAi(path, query) {
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, String(value))
    }
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  }
  if (projectId) {
    headers["OpenAI-Project"] = projectId
  }

  const response = await fetch(url, {headers})
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`OpenAI ${path} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

function formatDate(input) {
  const year = input.getUTCFullYear()
  const month = String(input.getUTCMonth() + 1).padStart(2, "0")
  const day = String(input.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function sumCosts(rows) {
  return rows.reduce((sum, item) => {
    const amount = Number(item?.amount?.value ?? item?.amount ?? 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
}

function normalizeByModel(rows) {
  const totals = new Map()
  for (const item of rows) {
    const model = String(item?.model ?? item?.snapshot_id ?? "unknown")
    const input = Number(item?.input_tokens ?? 0)
    const output = Number(item?.output_tokens ?? 0)
    const requests = Number(item?.num_model_requests ?? 0)
    const current = totals.get(model) ?? {inputTokens: 0, outputTokens: 0, requests: 0}
    current.inputTokens += Number.isFinite(input) ? input : 0
    current.outputTokens += Number.isFinite(output) ? output : 0
    current.requests += Number.isFinite(requests) ? requests : 0
    totals.set(model, current)
  }
  return [...totals.entries()].map(([model, values]) => ({model, ...values}))
}

async function main() {
  const [usage, costs] = await Promise.all([
    callOpenAi("/organization/usage/completions", {
      start_time: start,
      end_time: end,
      interval: "1d",
      group_by: "model,api_key_id"
    }),
    callOpenAi("/organization/costs", {
      start_time: start,
      end_time: end,
      interval: "1d"
    })
  ])

  const usageRows = Array.isArray(usage?.data) ? usage.data : []
  const costRows = Array.isArray(costs?.data) ? costs.data : []
  const byModel = normalizeByModel(usageRows)
  const latestDailyCosts = costRows.slice(-2)
  const previousCost = sumCosts(latestDailyCosts.slice(0, 1))
  const currentCost = sumCosts(latestDailyCosts.slice(1, 2))
  const dayDelta = previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : 0
  const anomaly = dayDelta > 30

  console.log(JSON.stringify({
    window: {start, end},
    projectId: projectId || null,
    currentCost,
    previousCost,
    dayDeltaPercent: Number(dayDelta.toFixed(2)),
    anomaly,
    byModel
  }, null, 2))

  if (anomaly) {
    console.error("Cost anomaly detected: day-over-day growth > 30%")
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
