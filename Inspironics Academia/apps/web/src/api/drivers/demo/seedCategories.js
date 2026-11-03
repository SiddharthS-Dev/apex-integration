import { DEFAULT_CATEGORIES } from '@academy/shared';

// Demo categories and audiences: the three standard categories; every playbook that already existed
// goes to Corporate Knowledge Base (as the API's migration does); one learning and one strategic
// playbook, each with a short published course, so every category has content. Lee is an employee,
// so the strategic course is the one the access rule hides from him.

const chapter = (number, title, summary, content) => ({ number: String(number), title, summary, content });

const LEARNING = {
  title: 'Git & GitHub for Interns',
  department: 'Engineering',
  tech_tags: ['Git', 'GitHub'],
  skill_level: 'beginner',
  tags: ['onboarding', 'version control'],
  chapters: [
    chapter(1, 'Why Version Control', 'What Git tracks and why every change goes through it.', 'Git records every change to the code as a commit, with who made it and why. It lets a team work in parallel without overwriting each other, and lets anyone go back to a known good state.'),
    chapter(2, 'Branches and Pull Requests', 'Working on a branch and asking for review.', 'Create a branch for each piece of work, commit small focused changes, push the branch and open a pull request. A reviewer reads the diff, asks questions and approves before it is merged into main.'),
    chapter(3, 'Resolving Conflicts', 'What a merge conflict is and how to fix one safely.', 'A conflict happens when two branches change the same lines. Git marks both versions in the file; keep the right lines, remove the markers, run the tests, then commit the resolution.'),
  ],
  course: {
    title: 'Version Control Foundations',
    description: 'Your first week with Git and GitHub: commits, branches, pull requests and merge conflicts.',
    difficulty: 'beginner',
  },
  lessons: [
    { title: 'Commits That Tell a Story', summary: 'Small commits with clear messages make history readable.', key_points: '- One logical change per commit\n- Write the why in the message', source_chapter: 'Why Version Control' },
    { title: 'Your First Pull Request', summary: 'Branch, push, open a pull request and respond to review.', key_points: '- Branch from main\n- Keep pull requests small\n- Reply to every review comment', source_chapter: 'Branches and Pull Requests' },
  ],
};

const STRATEGIC = {
  title: 'Strategic Planning & Portfolio Governance',
  department: 'Leadership',
  tech_tags: [],
  skill_level: 'advanced',
  tags: ['strategy', 'governance', 'portfolio'],
  chapters: [
    chapter(1, 'Setting Strategic Objectives', 'From vision to three measurable objectives a year.', 'Leadership agrees a small number of objectives, each with an owner and a measure. Every initiative in the portfolio must trace to one of them, or it is stopped.'),
    chapter(2, 'Portfolio Review Cadence', 'Quarterly reviews that decide what continues.', 'Each quarter the portfolio board reviews every initiative against value delivered, risk and cost to complete, and decides to continue, change course or stop.'),
    chapter(3, 'Risk and Decision Rights', 'Who decides what, and how risk is escalated.', 'Decision rights are written down: what a team decides alone, what needs a department head, and what goes to the board. Risks above the agreed tolerance are escalated within a week.'),
  ],
  course: {
    title: 'Leading the Portfolio',
    description: 'Objectives, quarterly portfolio reviews, decision rights and risk escalation for leaders.',
    difficulty: 'advanced',
  },
  lessons: [
    { title: 'Objectives Everyone Can Trace', summary: 'Three objectives, each with an owner and a measure.', key_points: '- Few objectives\n- Every initiative traces to one', source_chapter: 'Setting Strategic Objectives' },
    { title: 'Running a Portfolio Review', summary: 'Continue, change course or stop — decided every quarter.', key_points: '- Value, risk and cost to complete\n- Stopping is a valid outcome', source_chapter: 'Portfolio Review Cadence' },
  ],
};

function addCategorisedPlaybook(add, spec, category, age) {
  const slug = spec.title.toLowerCase().replace(/\W+/g, '-');
  const playbook = add('Playbook', {
    title: spec.title, file_url: `demo:seed-${slug}`, file_name: `${spec.title.replace(/\s+/g, '_')}.pdf`, file_type: 'pdf', file_size: 820_000,
    author: 'Inspironics Academy', organization: 'Inspironics', chapter_count: spec.chapters.length, version: '1.0',
    toc_summary: spec.chapters.map((c) => `${c.number}. ${c.title}`).join('\n'), source: 'upload', status: 'published', progress: 100,
    category, category_source: 'manual', department: spec.department, tech_tags: spec.tech_tags, skill_level: spec.skill_level, tags: spec.tags,
  }, age);
  spec.chapters.forEach((c) => add('Chapter', { playbook_id: playbook.id, ...c }, age));
  add('PlaybookVersion', {
    playbook_id: playbook.id, version_label: 'v1 (1.0)', title: spec.title, author: playbook.author, organization: playbook.organization,
    chapter_count: spec.chapters.length, toc_summary: playbook.toc_summary, file_name: playbook.file_name, file_size: playbook.file_size,
    chapters_snapshot: JSON.stringify(spec.chapters),
  }, age);
  const course = add('Course', {
    playbook_id: playbook.id, ...spec.course, status: 'published', published: true, module_count: 1, lesson_count: spec.lessons.length,
    version: '1', category,
  }, age - 1);
  const mod = add('Module', { course_id: course.id, title: spec.course.title, description: spec.course.description, order: 0, lesson_count: spec.lessons.length }, age - 1);
  spec.lessons.forEach((l, i) => add('Lesson', {
    module_id: mod.id, order: i, status: 'approved', video_type: 'concept', duration_target: '8-12 minutes', source_playbook: spec.title,
    teaching_objective: l.summary, teaching_script: `${l.summary} ${spec.chapters.find((c) => c.title === l.source_chapter)?.content || ''}`, ...l,
  }, age - 1));
  return playbook;
}

/**
 * Adds the categories, files every existing playbook (and its courses) under Corporate Knowledge Base,
 * and adds the learning and strategic examples. `tables` is the seed being built.
 */
export function addCategories(add, tables) {
  DEFAULT_CATEGORIES.forEach((c) => add('PlaybookCategory', { ...c }, 40));
  for (const p of tables.Playbook) {
    Object.assign(p, { category: 'corporate', category_source: 'migration', department: p.department || 'Engineering' });
  }
  const tech = { 'Site Reliability Engineering Playbook': ['SRE', 'Observability'], 'API Design Standards': ['REST', 'OpenAPI'] };
  for (const p of tables.Playbook) if (tech[p.title]) p.tech_tags = tech[p.title];
  for (const c of tables.Course) c.category = 'corporate';
  addCategorisedPlaybook(add, LEARNING, 'learning', 12);
  addCategorisedPlaybook(add, STRATEGIC, 'strategic', 9);
}
