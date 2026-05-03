// Inserts all questions from questions.js into Supabase.
// Run once: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node seed.js

import { createClient } from '@supabase/supabase-js'
import { QUESTIONS } from './questions.js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const rows = QUESTIONS.map(q => ({
  id:               q.id,
  category:         q.category,
  difficulty:       q.difficulty,
  question:         q.question,
  answer:           q.answer,
  answer_type:      q.answerType,
  accepted_answers: q.acceptedAnswers ?? [],
  time_limit:       q.timeLimit,
}))

const { error } = await supabase.from('questions').insert(rows)
if (error) {
  console.error('Seed failed:', error.message)
  process.exit(1)
}
console.log(`✓ Inserted ${rows.length} questions`)
