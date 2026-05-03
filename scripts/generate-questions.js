// Daily pipeline: generates 1 question per category via Hugging Face and inserts them into Supabase.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... HF_API_TOKEN=... node scripts/generate-questions.js

import { createClient } from '@supabase/supabase-js'

const CATEGORIES = ['histoire', 'geographie', 'litterature', 'art', 'cinema', 'sport', 'bd_manga', 'politique']
const VALID_DIFFICULTIES  = ['easy', 'medium', 'hard']
const VALID_ANSWER_TYPES  = ['text', 'name', 'date']
const VALID_TIME_LIMITS   = [10, 15, 20]
const HF_MODEL            = 'Qwen/Qwen2.5-7B-Instruct'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, HF_API_TOKEN } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !HF_API_TOKEN) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, HF_API_TOKEN')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function fetchExistingByCategory() {
  const { data, error } = await supabase.from('questions').select('category, question')
  if (error) throw new Error(`Failed to fetch questions: ${error.message}`)
  const grouped = Object.fromEntries(CATEGORIES.map(c => [c, []]))
  for (const row of data) {
    if (grouped[row.category]) grouped[row.category].push(row.question)
  }
  return grouped
}

function buildPrompt(category, count, existingQuestions) {
  const existingList = existingQuestions
    .slice(-20)
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n')

  return `Tu es un expert en quiz culturel francophone. Génère exactement ${count} question(s) de quiz en français pour la catégorie "${category}".

Règles:
- Questions en français uniquement
- Mélange de difficultés: easy (time_limit: 20), medium (time_limit: 15), hard (time_limit: 10)
- answer_type: "text" (réponse courte), "name" (nom de personne), "date" (année ou date)
- accepted_answers: variantes orthographiques acceptées (tableau, peut être vide)
- Évite des questions similaires à celles déjà existantes:
${existingList}

Retourne UNIQUEMENT un tableau JSON valide, sans aucun texte avant ou après:
[
  {
    "category": "${category}",
    "difficulty": "easy",
    "question": "...",
    "answer": "...",
    "answer_type": "text",
    "accepted_answers": [],
    "time_limit": 20
  }
]`
}

async function callHF(prompt) {
  const res = await fetch(
    'https://router.huggingface.co/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HF_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    }
  )
  if (!res.ok) throw new Error(`HF API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

function extractJSON(text) {
  try {
    const parsed = JSON.parse(text.trim())
    if (Array.isArray(parsed)) return parsed
  } catch {}
  const match = text.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  return null
}

function validate(q, expectedCategory) {
  if (typeof q.question !== 'string' || !q.question.trim()) return 'missing question'
  if (typeof q.answer !== 'string' || !q.answer.trim())     return 'missing answer'
  if (!VALID_DIFFICULTIES.includes(q.difficulty))            return `invalid difficulty: ${q.difficulty}`
  if (!VALID_ANSWER_TYPES.includes(q.answer_type))          return `invalid answer_type: ${q.answer_type}`
  if (!VALID_TIME_LIMITS.includes(q.time_limit))            return `invalid time_limit: ${q.time_limit}`
  if (!Array.isArray(q.accepted_answers))                   return 'accepted_answers must be array'
  if (q.category !== expectedCategory)                      return `wrong category: ${q.category}`
  return null
}

async function main() {
  console.log('Fetching existing questions...')
  const existingByCategory = await fetchExistingByCategory()
  const total = Object.values(existingByCategory).reduce((s, a) => s + a.length, 0)
  console.log(`Found ${total} existing questions`)

  const toInsert = []
  let skipped = 0

  for (const category of CATEGORIES) {
    const count = 1
    console.log(`\nGenerating 1 question for "${category}"...`)

    let raw
    try {
      raw = await callHF(buildPrompt(category, count, existingByCategory[category]))
    } catch (err) {
      console.warn(`  HF API failed for ${category}: ${err.message}`)
      skipped += count
      continue
    }

    const questions = extractJSON(raw)
    if (!questions) {
      console.warn(`  Could not parse JSON for ${category}. Response: ${raw.slice(0, 200)}`)
      skipped += count
      continue
    }

    for (const q of questions) {
      const err = validate(q, category)
      if (err) {
        console.warn(`  Skipping (${err}): ${JSON.stringify(q).slice(0, 100)}`)
        skipped++
        continue
      }
      const isDuplicate = existingByCategory[category].some(
        ex => ex.toLowerCase().trim() === q.question.toLowerCase().trim()
      )
      if (isDuplicate) {
        console.warn(`  Skipping duplicate: ${q.question}`)
        skipped++
        continue
      }
      toInsert.push({
        category:        q.category,
        difficulty:      q.difficulty,
        question:        q.question,
        answer:          q.answer,
        answer_type:     q.answer_type,
        accepted_answers: q.accepted_answers,
        time_limit:      q.time_limit,
      })
      console.log(`  ✓ ${q.question.slice(0, 70)}`)
    }
  }

  if (toInsert.length === 0) {
    console.log('\nNo valid questions to insert.')
    return
  }

  console.log(`\nInserting ${toInsert.length} question(s) into Supabase...`)
  const { error } = await supabase.from('questions').insert(toInsert)
  if (error) { console.error('Insert failed:', error.message); process.exit(1) }

  console.log(`\n✓ Done — inserted: ${toInsert.length}, skipped: ${skipped}`)
}

main().catch(err => { console.error(err); process.exit(1) })
