// AI Studio content types: what the Content Generator can write, each with its instructions and output
// shape. Markdown types return text; question types return structured JSON.

const LENGTHS = {
  short: 'Keep it short: about 150–250 words.',
  medium: 'Medium length: about 400–700 words.',
  long: 'Thorough: about 900–1,400 words.',
};
const TONES = {
  professional: 'professional and clear',
  friendly: 'warm, friendly and encouraging',
  formal: 'formal and precise',
  conversational: 'conversational, like an instructor speaking to the learner',
};

const MCQ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correct_answer: { type: 'string' },
          explanation: { type: 'string' },
          difficulty: { type: 'string', enum: ['basic', 'intermediate', 'advanced'] },
        },
      },
    },
  },
};

export const CONTENT_TYPES = {
  lesson_content: { label: 'Lesson content', format: 'markdown', task: 'Write a complete lesson: an introduction, the teaching content in sections with headings, a worked example, key takeaways as a bullet list, and a short recap.' },
  course_description: { label: 'Course description', format: 'markdown', task: 'Write a compelling course description: who it is for, what learners will be able to do, what it covers (bullet list) and how long it takes.' },
  learning_objectives: { label: 'Learning objectives', format: 'markdown', task: 'Write 5–8 measurable learning objectives as a bullet list, each starting with an action verb (Explain, Apply, Configure, Evaluate…).' },
  lesson_summary: { label: 'Lesson summary', format: 'markdown', task: 'Summarise the material for a learner: a 3–5 sentence overview, then 5–8 key points as bullets.' },
  assessment: { label: 'Assessment (MCQs)', format: 'json', schema: MCQ_SCHEMA, task: 'Write 10 multiple-choice questions that test understanding and application, with 4 distinct plausible options each, one correct answer copied exactly from the options, and a one-sentence explanation.' },
  question_bank: { label: 'Question bank', format: 'json', schema: MCQ_SCHEMA, task: 'Write a bank of 25 multiple-choice questions covering the whole material, mixing basic, intermediate and advanced difficulty, 4 options each, one correct answer copied exactly from the options, with explanations.' },
  meeting_summary: { label: 'Meeting summary', format: 'markdown', task: 'Write meeting minutes: purpose, summary, decisions (with reasons), action items as a table (task, owner, due), open questions and risks.' },
  playbook_extraction: { label: 'Playbook extraction', format: 'json', task: 'Identify the chapters of this playbook in order, with a 2–3 sentence summary of each.', schema: { type: 'object', properties: { chapters: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' } } } } } } },
  playbook_structure: { label: 'Playbook structure (course outline)', format: 'json', task: 'Design a course from this playbook: modules in order, each with lessons that have a title and a teaching objective starting with an action verb.', schema: { type: 'object', properties: { modules: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, lessons: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, teaching_objective: { type: 'string' } } } } } } } } } },
  custom: { label: 'Custom (follow my instructions)', format: 'markdown', task: 'Follow the instructions below.' },
};

export const contentTypeList = () => Object.entries(CONTENT_TYPES).map(([key, t]) => ({ key, label: t.label, format: t.format }));

export function buildStudioPrompt(type, { language = 'English', length = 'medium', tone = 'professional', instructions = '', source = '' }) {
  const t = CONTENT_TYPES[type];
  const lines = [
    `You are an instructional designer at Inspironics Engineering Academy. ${t.task}`,
    `Write in ${language}. Tone: ${TONES[tone] || TONES.professional}.${t.format === 'markdown' ? ` ${LENGTHS[length] || LENGTHS.medium}` : ''}`,
    t.format === 'markdown' ? 'Format the answer as Markdown. Do not add a preamble or a closing remark.' : 'Answer with JSON only.',
    source ? 'Use only the facts in the SOURCE MATERIAL; keep its terminology, rules and numbers exactly. Do not invent facts.' : 'There is no source material: rely on the instructions and general, uncontroversial knowledge.',
    instructions ? `Additional instructions from the author:\n${instructions}` : '',
    source ? `SOURCE MATERIAL\n"""\n${source}\n"""` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

export { LENGTHS, TONES };
