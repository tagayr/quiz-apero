-- Run this in the Supabase SQL editor to set up the questions table

CREATE TABLE questions (
  id               SERIAL  PRIMARY KEY,
  category         TEXT    NOT NULL,
  difficulty       TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question         TEXT    NOT NULL,
  answer           TEXT    NOT NULL,
  answer_type      TEXT    NOT NULL CHECK (answer_type IN ('text', 'name', 'date')),
  accepted_answers TEXT[]  NOT NULL DEFAULT '{}',
  time_limit       INTEGER NOT NULL DEFAULT 15
);

-- Allow anyone to read, but nobody to write via the anon key
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON questions
  FOR SELECT USING (true);
