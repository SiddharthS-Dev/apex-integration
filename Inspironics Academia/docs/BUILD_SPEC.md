# Inspironics Engineering Academy — Master Build Spec

Reference specification for the platform. Sections are numbered as in the original master build prompt.

> **Runtime note:** the platform no longer runs on Base44. The data model, RLS rules and pipeline behaviour below still hold. They are now served by our own API (`apps/api`) and shared contracts (`packages/shared`), and playbooks can also come from Dropbox sync — see the top-level README. Base44 references below describe the original design; the retired code is in `legacy/base44`.

## 1. Mission

Transforms company engineering playbooks into structured learning paths, interactive video scripts, and assessment modules.

Pipeline: admin uploads playbook (PDF/DOCX) → extract chapters/sections → LLM structures a course (modules → lessons) with traceability to the source → each lesson gets AI teaching content (script, summary, key points, examples), quiz questions, flashcards → each lesson gets AI video + narration audio → admin reviews, approves, publishes → learners browse catalog, take courses, watch lessons, take tests, earn certificates → certificates verifiable via public QR endpoint.

## 2. Stack

React 18 + Vite + Tailwind + shadcn/ui, react-router-dom v6, @tanstack/react-query + Base44 SDK, lucide-react, recharts, react-quill-new, react-markdown, Base44 serverless functions (TypeScript/Deno), Base44 entities, Base44 managed auth, Base44 Core integrations (InvokeLLM, GenerateVideo, GenerateSpeech, GenerateImage), pdf-parse (PDF), JSZip (DOCX).

Allowed npm packages: react, react-dom, react-router-dom, @tanstack/react-query, tailwindcss, tailwindcss-animate, lucide-react, recharts, react-quill-new, react-markdown, framer-motion, three, react-leaflet, @hello-pangea/dnd, date-fns, lodash, moment, @base44/sdk, @base44/vite-plugin, class-variance-authority, clsx, tailwind-merge, shadcn/ui (@radix-ui/*), sonner, next-themes, canvas-confetti, html2canvas, jspdf, @stripe/react-stripe-js, @stripe/stripe-js. **Do not add others.**

## 3. Visual language

- Primary: Indigo-600 `hsl(243 75% 59%)`; gradient `from-indigo-500 to-violet-600` for logos, avatars, progress bars.
- Cards: `rounded-2xl border border-border bg-card p-5`. Icons boxes `rounded-xl`, inputs `rounded-lg`.
- Admin buttons default to `size="sm"`.
- Status colors: emerald (approved), amber (pending_review), blue (generating), slate (pending), rose (rejected).
- Page layout: `max-w-7xl mx-auto px-4 sm:px-6 py-8`.
- Tokens live in `src/index.css`; use semantic classes (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary/10 text-primary`). Always also consider dark mode (`dark:` variants for raw palette colors such as `bg-emerald-100`).

## 4. Data model (entities)

Built-in fields on every record: `id, created_date, updated_date, created_by_id` (never declare).

| Entity | Fields |
|---|---|
| Playbook | title, file_url, file_name, file_type, file_size(0), version, author, organization, status(uploaded\|processing\|processed\|needs_review\|failed\|published = uploaded), chapter_count(0), toc_summary, progress(0), error. required: title, file_url |
| Chapter | playbook_id, title, number, summary, content, section_count(0). required: playbook_id, title |
| PlaybookVersion | playbook_id, version_label, title, author, organization, chapter_count(0), toc_summary, file_name, file_size(0), chapters_snapshot (JSON string). required: playbook_id, version_label |
| Course | playbook_id, title, description, status(draft\|pending_review\|published\|archived = draft), module_count(0), lesson_count(0), published(bool false), difficulty(beginner\|intermediate\|advanced = beginner), version(string "1"), access_level(free\|premium = free). required: title |
| Module | course_id, title, description, order(0), lesson_count(0), source_chapters. required: course_id, title |
| Lesson | module_id, title, teaching_objective, video_title, video_url, audio_url, video_type(concept\|deep_dive\|example\|architecture\|demonstration\|revision = concept), teaching_script, summary, examples, key_points, duration_target, source_playbook, source_chapter, source_section, status(pending\|generating\|pending_review\|approved\|rejected = pending), order(0). required: module_id, title |
| Question | lesson_id, assessment_id, question_text, options(string[]), correct_answer, explanation, difficulty(basic\|intermediate\|advanced = basic), cognitive_level(recall\|understanding\|application\|analysis = recall), source_playbook, source_chapter, source_section, marks(1), status(pending_review\|approved\|rejected = pending_review). required: question_text |
| Assessment | course_id, module_id, playbook_id, title, type(module_test\|course_assessment\|certification = course_assessment), question_count(0), passing_score(70), duration_minutes(60), status(pending_review\|approved\|published = pending_review). required: title |
| Flashcard | lesson_id, front, back, difficulty(basic\|intermediate\|advanced), source_playbook, source_chapter, source_section, status(pending_review\|approved\|rejected). required: lesson_id, front, back |
| CourseProgress | user_id, course_id, completed_lessons(string[]), completed_chapters(string[] — module ids whose chapter test was passed), percentage(0), final_score(0), final_passed(false), started(false). required: user_id, course_id |
| QuizAttempt | user_id, course_id, module_id, lesson_id, assessment_id, type(lesson\|chapter\|final = lesson), score(0), total(0), percentage(0), passed(false). required: user_id, type |
| Certificate | user_id, course_id, course_title, user_name, score(0), completion_date(date), certificate_id. required: user_id, course_id |
| Bookmark | user_id, lesson_id, course_id, note. required: user_id, lesson_id |
| LessonFeedback | user_id, lesson_id, course_id, rating(1-5), comment, status(open\|reviewed\|resolved = open). required: user_id, lesson_id, rating |
| ReviewSchedule | user_id, flashcard_id, lesson_id, course_id, ease_factor(2.5), interval_days(0), reps(0), due_date(date), last_reviewed(date). required: user_id, flashcard_id |
| User (built-in) | id, created_date, full_name, email, role (admin\|user). Only admins list/update other users. |

Text fields `key_points`, `examples` on Lesson are plain text strings (newline-separated / markdown). `source_chapters` on Module is a string (comma-separated chapter titles).

## 5. RLS summary

| Entity | Read | Create | Update | Delete |
|---|---|---|---|---|
| Playbook | Public | Admin | Admin | Admin |
| Chapter | Admin | Admin | Admin | Admin |
| PlaybookVersion | Admin | Admin | Admin | Admin |
| Course | Published OR Admin | Admin | Admin | Admin |
| Module | Public | Admin | Admin | Admin |
| Lesson | Approved OR Admin | Admin | Admin | Admin |
| Question | Approved OR Admin | Admin | Admin | Admin |
| Assessment | Published OR Admin | Admin | Admin | Admin |
| Flashcard | Approved OR Admin | Admin | Admin | Admin |
| CourseProgress | Owner OR Admin | Owner | Owner OR Admin | Owner OR Admin |
| QuizAttempt | Owner OR Admin | Owner | Owner OR Admin | Owner OR Admin |
| Certificate | Owner OR Admin | Owner | Admin | Admin |
| Bookmark | Owner | Owner | Owner | Owner |
| LessonFeedback | Owner OR Admin | Owner | Admin | Admin |
| ReviewSchedule | Owner | Owner | Owner | Owner |

All AI content starts `pending_review` and is invisible to learners until approved. Learners see only published courses, approved lessons/questions/flashcards, published assessments.

## 6. Backend functions (base44/functions/{name}/entry.ts)

Deno, `import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51'`, `Deno.serve(async (req) => …)`, entity ops via `base44.asServiceRole`. Frontend calls `base44.functions.invoke(name, payload)` → response `.data`.

- **processPlaybookExtract** `{playbook_id}` admin — status processing/progress 15; download file_url (private file → `CreateFileSignedUrl`); parse PDF (pdf-parse@1.1.1) / DOCX (jszip@3.10.1 → word/document.xml, strip tags); detect chapters three ways (TOC-guided search skipping first 5000 chars; hybrid number search Chapter/Volume/Part/Book/Module/Unit with TOC titles; regex headings `Chapter 1: Title`, `Part II — Title`), pick most results; if ≥2 chapters use verbatim content and call LLM only for metadata + per-chapter summaries with conditional title correction (title starts lowercase, >120 chars, or sentence-like); else LLM fallback on 200k-char sample; update Playbook (title/version/author/organization/toc_summary/chapter_count, progress 50); delete old Chapters, bulkCreate new (content ≤12k chars); create PlaybookVersion snapshot; return `{ok, stage:'extract', playbook_id, chapter_count}`. On failure set status failed + error.
- **processPlaybookStructure** `{playbook_id, force?}` admin — skip if active course (pending_review/published) unless force; digest (title+summary+8k content per chapter); LLM with strict coverage (≥1 lesson per section, no omissions, granular lessons, source_chapter+source_section per lesson); archive old courses (status archived, published false); new Course pending_review, version = max+1; Modules + Lessons (bulkCreate per module; source_playbook, status pending, duration_target '8-12 minutes'); update counts; Playbook needs_review, progress 100; return `{ok, stage:'structure', course_id, module_count, lesson_count, chapter_count}`.
- **generateLessonContent** `{lesson_id}` admin — status generating; resolve playbook via module→course→playbook_id, chapter content matching source_chapter; LLM (instructor-led style): video_title, teaching_script (~8-12 min, plain text), summary, examples, key_points, 6 mcqs (4 options, correct_answer exactly an option, explanation, difficulty, cognitive_level, source_section), 5 flashcards; delete old Questions/Flashcards for lesson, bulkCreate new (pending_review); lesson → pending_review. On error reset to pending.
- **generateLessonMedia** `{lesson_id}` admin — status generating; video prompt (educational explainer, indigo/violet palette, motion graphics, animated diagrams, no audio, 8 s, 16:9); narration from teaching_script ≤5000 chars, voice `storm`; Promise.allSettled with 2 attempts each; both fail → pending_review + error; else save video_url/audio_url, pending_review.
- **generateAssessment** `{course_id, type, module_id?}` admin — counts module_test 15 / course_assessment 50 / certification 60; passing 70; durations 30/60/90; lesson digest; LLM questions spread across lessons, mixed difficulty/cognitive level, scenario-based; create Assessment (pending_review) + Questions (pending_review, assessment_id set).
- **verifyCertificate** `{certificate_id}` public — returns `{valid, user_name, course_title, score, completion_date, certificate_id}` or `{valid:false}`.

## 7. Status lifecycles

- Playbook: uploaded → processing → processed → needs_review → published (or failed)
- Course: draft → pending_review → published (or archived on re-process)
- Lesson: pending → generating → pending_review → approved (or rejected → back to pending)
- Question/Flashcard: pending_review → approved (or rejected)
- Assessment: pending_review → approved → published

## 12. Admin Dashboard

Loads in one Promise.all: Playbook.list('-created_date',100), Course.list('-updated_date',100), Lesson.list('-created_date',500), User.list(), Assessment.list('-created_date',100), Certificate.list('-created_date',100), CourseProgress.list('-updated_date',100), QuizAttempt.list('-created_date',200), Module.list('-created_date',200), Question.list('-created_date',500), Flashcard.list('-created_date',500).

Layout: 6 stat cards (Playbooks, Courses, Lessons, Learners, Tests, Certificates) → CoverageStats (2/3: coverage % approved/total, segmented bar emerald/amber/blue/slate/rose, counts with dots, generation rate (approved+pending_review+generating)/total) + PendingReviewQueue (1/3: lessons/questions/assessments/flashcards pending counts + total) → PlaybookGenerationStatus table (per playbook: title, course status, total lessons, counts pending/generating/review/approved, coverage bar, review link to /admin/studio/:playbookId; sorted coverage ascending; join Lesson→Module→Course→Playbook) → Recent Playbook Uploads + Recent Course Activity (2/3) + Learner Progress (1/3) → AdminAnalytics charts (enrollment, completion, test performance).

## 13. Content Studio (/admin/studio/:playbookId)

Actions: Generate Learning Package (loop pending/rejected lessons → generateLessonContent, progress bar); Generate Tests (generateAssessment per module module_test + one course_assessment); Regenerate Media (loop lessons → generateLessonMedia); Approve All (lessons + questions + assessments for course); Publish (approve everything, course status published + published true, playbook published, redirect /courses).
Layout: header (back, course title, actions) → progress bars → ReviewProgress → left CourseTree (modules → lessons w/ status colors) + right LessonReviewPanel (selected lesson) + CoverageMap. Course selection prefers non-archived; priority pending_review > published > draft > archived.

## 14. Business logic

- Re-processing archives old courses (preserves learner progress/certificates). New version = max+1. Each extraction snapshots PlaybookVersion; PlaybookVersionHistory shows side-by-side word-level LCS diff (`src/lib/diff.js`: `diffWords(old,new)` → `[{type:'equal'|'added'|'removed', value}]`, `diffStats(parts)`).
- Lessons auto-play generated media on load (AiVideoPlayer handles video + audio sync).
- TextToVoiceButton (top-right of lesson content card): summarize lesson and read aloud using browser `speechSynthesis`.
- Final test pass (≥ passing_score) → create Certificate with unique certificate_id (`generateCertificateId()` in `src/lib/progress.js`). CertificateView = printable certificate with QR code linking to `/verify/:certificateId`. (QR: render via `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=<encoded url>` in the Image component — no extra npm package.)
- SM-2 flashcard scheduling via ReviewSchedule (`sm2(schedule, quality)` in `src/lib/progress.js`).
- Playbook uploads use `base44.integrations.Core.UploadPrivateFile({file})` → `{file_uri}` stored as Playbook.file_url.

## 18. Status colors

`src/components/admin/StatusBadge.jsx` exports `STATUS_COLORS`, `statusLabel`, default `StatusBadge({status})`.
