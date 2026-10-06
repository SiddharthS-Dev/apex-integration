export const ROLES = Object.freeze({ ADMIN: 'admin', USER: 'user' });

// Playbook source files the pipeline can read.
export const PLAYBOOK_FILE_TYPES = Object.freeze({
  pdf: { mime: 'application/pdf', label: 'PDF' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
});

export const PLAYBOOK_EXTENSIONS = Object.keys(PLAYBOOK_FILE_TYPES);

export function fileExtension(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function isPlaybookFile(name) {
  return PLAYBOOK_EXTENSIONS.includes(fileExtension(name));
}

// Backend functions exposed at POST /api/functions/:name. `public` ones need no session.
export const FUNCTIONS = Object.freeze({
  processPlaybookExtract: { admin: true },
  processPlaybookStructure: { admin: true },
  generateLessonContent: { admin: true },
  generateLessonMedia: { admin: true },
  generateAssessment: { admin: true },
  submitFinalTest: {},
  verifyCertificate: { public: true },
});

export const SESSION_COOKIE = 'iea_session';
