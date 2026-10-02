// Entity schemas + row-level security rules. Consumed by the API (tables, RLS) and the web demo backend.
// Built-in fields on every record: id, created_date, updated_date, created_by_id.

export const ENTITIES = {
  "Assessment": {
    "properties": {
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "module_id": {
        "type": "string",
        "description": "Module id (for module tests)"
      },
      "playbook_id": {
        "type": "string",
        "description": "Source playbook id"
      },
      "title": {
        "type": "string",
        "description": "Assessment title"
      },
      "type": {
        "type": "string",
        "enum": [
          "module_test",
          "course_assessment",
          "certification"
        ],
        "description": "Assessment type",
        "default": "course_assessment"
      },
      "question_count": {
        "type": "number",
        "description": "Number of questions",
        "default": 0
      },
      "passing_score": {
        "type": "number",
        "description": "Passing percentage",
        "default": 70
      },
      "duration_minutes": {
        "type": "number",
        "description": "Time limit in minutes",
        "default": 60
      },
      "status": {
        "type": "string",
        "enum": [
          "pending_review",
          "approved",
          "published"
        ],
        "description": "Lifecycle status",
        "default": "pending_review"
      }
    },
    "required": [
      "title"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.status": "published"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Bookmark": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "lesson_id": {
        "type": "string",
        "description": "Lesson id"
      },
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "note": {
        "type": "string",
        "description": "Optional note"
      }
    },
    "required": [
      "user_id",
      "lesson_id"
    ],
    "rls": {
      "read": {
        "data.user_id": "{{user.id}}"
      },
      "create": {
        "data.user_id": "{{user.id}}"
      },
      "update": {
        "data.user_id": "{{user.id}}"
      },
      "delete": {
        "data.user_id": "{{user.id}}"
      }
    }
  },
  "Certificate": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "course_title": {
        "type": "string",
        "description": "Course title at issue time"
      },
      "user_name": {
        "type": "string",
        "description": "Learner name at issue time"
      },
      "score": {
        "type": "number",
        "description": "Final score percentage",
        "default": 0
      },
      "completion_date": {
        "type": "string",
        "format": "date",
        "description": "Completion date"
      },
      "certificate_id": {
        "type": "string",
        "description": "Unique public certificate id"
      }
    },
    "required": [
      "user_id",
      "course_id"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "data.user_id": "{{user.id}}"
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Chapter": {
    "properties": {
      "playbook_id": {
        "type": "string",
        "description": "Parent playbook id"
      },
      "title": {
        "type": "string",
        "description": "Chapter title"
      },
      "number": {
        "type": "string",
        "description": "Chapter number/label (e.g. \"1\", \"II\")"
      },
      "summary": {
        "type": "string",
        "description": "Short summary of the chapter"
      },
      "content": {
        "type": "string",
        "description": "Verbatim chapter content (max 12,000 chars)"
      },
      "section_count": {
        "type": "number",
        "description": "Number of sections detected in the chapter",
        "default": 0
      }
    },
    "required": [
      "playbook_id",
      "title"
    ],
    "rls": {
      "read": {
        "user_condition": {
          "role": "admin"
        }
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Course": {
    "properties": {
      "playbook_id": {
        "type": "string",
        "description": "Source playbook id"
      },
      "title": {
        "type": "string",
        "description": "Course title"
      },
      "description": {
        "type": "string",
        "description": "Course description"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "pending_review",
          "published",
          "archived"
        ],
        "description": "Course lifecycle status",
        "default": "draft"
      },
      "module_count": {
        "type": "number",
        "description": "Number of modules",
        "default": 0
      },
      "lesson_count": {
        "type": "number",
        "description": "Number of lessons",
        "default": 0
      },
      "published": {
        "type": "boolean",
        "description": "Whether the course is visible to learners",
        "default": false
      },
      "difficulty": {
        "type": "string",
        "enum": [
          "beginner",
          "intermediate",
          "advanced"
        ],
        "description": "Course difficulty",
        "default": "beginner"
      },
      "version": {
        "type": "string",
        "description": "Course version (incremented on re-processing)",
        "default": "1"
      },
      "access_level": {
        "type": "string",
        "enum": [
          "free",
          "premium"
        ],
        "description": "Access level",
        "default": "free"
      }
    },
    "required": [
      "title"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.status": "published"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "CourseProgress": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "completed_lessons": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Completed lesson ids"
      },
      "completed_chapters": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Module ids whose chapter test was passed"
      },
      "percentage": {
        "type": "number",
        "description": "Completion percentage",
        "default": 0
      },
      "final_score": {
        "type": "number",
        "description": "Final test score percentage",
        "default": 0
      },
      "final_passed": {
        "type": "boolean",
        "description": "Whether the final test was passed",
        "default": false
      },
      "started": {
        "type": "boolean",
        "description": "Whether the learner has started the course",
        "default": false
      }
    },
    "required": [
      "user_id",
      "course_id"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "data.user_id": "{{user.id}}"
      },
      "update": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "delete": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      }
    }
  },
  "Flashcard": {
    "properties": {
      "lesson_id": {
        "type": "string",
        "description": "Lesson id"
      },
      "front": {
        "type": "string",
        "description": "Front (prompt) of the card"
      },
      "back": {
        "type": "string",
        "description": "Back (answer) of the card"
      },
      "difficulty": {
        "type": "string",
        "enum": [
          "basic",
          "intermediate",
          "advanced"
        ],
        "description": "Difficulty"
      },
      "source_playbook": {
        "type": "string",
        "description": "Title of the source playbook"
      },
      "source_chapter": {
        "type": "string",
        "description": "Source chapter title in the playbook"
      },
      "source_section": {
        "type": "string",
        "description": "Source section heading within the chapter"
      },
      "status": {
        "type": "string",
        "enum": [
          "pending_review",
          "approved",
          "rejected"
        ],
        "description": "Review status"
      }
    },
    "required": [
      "lesson_id",
      "front",
      "back"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.status": "approved"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Lesson": {
    "properties": {
      "module_id": {
        "type": "string",
        "description": "Parent module id"
      },
      "title": {
        "type": "string",
        "description": "Lesson title"
      },
      "teaching_objective": {
        "type": "string",
        "description": "What the learner should be able to do after the lesson"
      },
      "video_title": {
        "type": "string",
        "description": "Title of the lesson video"
      },
      "video_url": {
        "type": "string",
        "description": "Generated video URL"
      },
      "audio_url": {
        "type": "string",
        "description": "Generated narration audio URL"
      },
      "video_scenes": {
        "type": "string",
        "description": "JSON array of video scenes synced to the narration: [{ start, end, title, video_url }] (seconds)"
      },
      "video_type": {
        "type": "string",
        "enum": [
          "concept",
          "deep_dive",
          "example",
          "architecture",
          "demonstration",
          "revision"
        ],
        "description": "Video style",
        "default": "concept"
      },
      "teaching_script": {
        "type": "string",
        "description": "Instructor-led narration script (plain text)"
      },
      "summary": {
        "type": "string",
        "description": "Lesson summary"
      },
      "examples": {
        "type": "string",
        "description": "Worked examples (markdown / newline-separated)"
      },
      "key_points": {
        "type": "string",
        "description": "Key points (newline-separated)"
      },
      "duration_target": {
        "type": "string",
        "description": "Target duration, e.g. \"8-12 minutes\""
      },
      "source_playbook": {
        "type": "string",
        "description": "Title of the source playbook"
      },
      "source_chapter": {
        "type": "string",
        "description": "Source chapter title in the playbook"
      },
      "source_section": {
        "type": "string",
        "description": "Source section heading within the chapter"
      },
      "status": {
        "type": "string",
        "enum": [
          "pending",
          "generating",
          "pending_review",
          "approved",
          "rejected"
        ],
        "description": "Lesson lifecycle status",
        "default": "pending"
      },
      "order": {
        "type": "number",
        "description": "Display order within the module",
        "default": 0
      }
    },
    "required": [
      "module_id",
      "title"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.status": "approved"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "LessonFeedback": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "lesson_id": {
        "type": "string",
        "description": "Lesson id"
      },
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "rating": {
        "type": "number",
        "enum": [
          1,
          2,
          3,
          4,
          5
        ],
        "description": "Rating 1-5"
      },
      "comment": {
        "type": "string",
        "description": "Feedback comment"
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "reviewed",
          "resolved"
        ],
        "description": "Triage status",
        "default": "open"
      }
    },
    "required": [
      "user_id",
      "lesson_id",
      "rating"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "data.user_id": "{{user.id}}"
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Module": {
    "properties": {
      "course_id": {
        "type": "string",
        "description": "Parent course id"
      },
      "title": {
        "type": "string",
        "description": "Module title"
      },
      "description": {
        "type": "string",
        "description": "Module description"
      },
      "order": {
        "type": "number",
        "description": "Display order",
        "default": 0
      },
      "lesson_count": {
        "type": "number",
        "description": "Number of lessons",
        "default": 0
      },
      "source_chapters": {
        "type": "string",
        "description": "Comma-separated source chapter titles"
      }
    },
    "required": [
      "course_id",
      "title"
    ],
    "rls": {
      "read": {},
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Playbook": {
    "properties": {
      "title": {
        "type": "string",
        "description": "Playbook title"
      },
      "file_url": {
        "type": "string",
        "description": "Uploaded file URL or private file URI"
      },
      "file_name": {
        "type": "string",
        "description": "Original file name"
      },
      "file_type": {
        "type": "string",
        "description": "MIME type or extension of the uploaded file"
      },
      "file_size": {
        "type": "number",
        "description": "File size in bytes",
        "default": 0
      },
      "version": {
        "type": "string",
        "description": "Playbook version as stated in the document"
      },
      "author": {
        "type": "string",
        "description": "Author of the playbook"
      },
      "organization": {
        "type": "string",
        "description": "Organization that owns the playbook"
      },
      "status": {
        "type": "string",
        "enum": [
          "uploaded",
          "processing",
          "processed",
          "needs_review",
          "failed",
          "published",
          "archived"
        ],
        "description": "Processing status",
        "default": "uploaded"
      },
      "chapter_count": {
        "type": "number",
        "description": "Number of extracted chapters",
        "default": 0
      },
      "toc_summary": {
        "type": "string",
        "description": "Table of contents summary (one entry per line)"
      },
      "progress": {
        "type": "number",
        "description": "Processing progress 0-100",
        "default": 0
      },
      "error": {
        "type": "string",
        "description": "Last processing error message"
      },
      "source": {
        "type": "string",
        "enum": [
          "upload",
          "dropbox"
        ],
        "default": "upload"
      },
      "external_id": {
        "type": "string"
      },
      "revision": {
        "type": "string"
      },
      "dropbox_path": {
        "type": "string"
      },
      "content_hash": {
        "type": "string"
      },
      "last_seen_at": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "title",
      "file_url"
    ],
    "rls": {
      "read": {},
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "PlaybookVersion": {
    "properties": {
      "playbook_id": {
        "type": "string",
        "description": "Parent playbook id"
      },
      "version_label": {
        "type": "string",
        "description": "Version label for this snapshot"
      },
      "title": {
        "type": "string",
        "description": "Playbook title at snapshot time"
      },
      "author": {
        "type": "string",
        "description": "Author at snapshot time"
      },
      "organization": {
        "type": "string",
        "description": "Organization at snapshot time"
      },
      "chapter_count": {
        "type": "number",
        "description": "Number of chapters in this snapshot",
        "default": 0
      },
      "toc_summary": {
        "type": "string",
        "description": "Table of contents summary at snapshot time"
      },
      "file_name": {
        "type": "string",
        "description": "File name at snapshot time"
      },
      "file_size": {
        "type": "number",
        "description": "File size in bytes at snapshot time",
        "default": 0
      },
      "chapters_snapshot": {
        "type": "string",
        "description": "JSON string: array of {title, number, summary, content}"
      }
    },
    "required": [
      "playbook_id",
      "version_label"
    ],
    "rls": {
      "read": {
        "user_condition": {
          "role": "admin"
        }
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "Question": {
    "properties": {
      "lesson_id": {
        "type": "string",
        "description": "Lesson id (for lesson quizzes)"
      },
      "assessment_id": {
        "type": "string",
        "description": "Assessment id (for tests)"
      },
      "question_text": {
        "type": "string",
        "description": "Question text"
      },
      "options": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Answer options"
      },
      "correct_answer": {
        "type": "string",
        "description": "Correct answer (exactly one of the options)"
      },
      "explanation": {
        "type": "string",
        "description": "Explanation of the correct answer"
      },
      "difficulty": {
        "type": "string",
        "enum": [
          "basic",
          "intermediate",
          "advanced"
        ],
        "description": "Difficulty",
        "default": "basic"
      },
      "cognitive_level": {
        "type": "string",
        "enum": [
          "recall",
          "understanding",
          "application",
          "analysis"
        ],
        "description": "Bloom's cognitive level",
        "default": "recall"
      },
      "source_playbook": {
        "type": "string",
        "description": "Title of the source playbook"
      },
      "source_chapter": {
        "type": "string",
        "description": "Source chapter title in the playbook"
      },
      "source_section": {
        "type": "string",
        "description": "Source section heading within the chapter"
      },
      "marks": {
        "type": "number",
        "description": "Marks awarded",
        "default": 1
      },
      "status": {
        "type": "string",
        "enum": [
          "pending_review",
          "approved",
          "rejected"
        ],
        "description": "Review status",
        "default": "pending_review"
      }
    },
    "required": [
      "question_text"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.status": "approved"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "user_condition": {
          "role": "admin"
        }
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  },
  "QuizAttempt": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "module_id": {
        "type": "string",
        "description": "Module id"
      },
      "lesson_id": {
        "type": "string",
        "description": "Lesson id"
      },
      "assessment_id": {
        "type": "string",
        "description": "Assessment id"
      },
      "type": {
        "type": "string",
        "enum": [
          "lesson",
          "chapter",
          "final"
        ],
        "description": "Attempt type",
        "default": "lesson"
      },
      "score": {
        "type": "number",
        "description": "Correct answers / marks earned",
        "default": 0
      },
      "total": {
        "type": "number",
        "description": "Total questions / marks",
        "default": 0
      },
      "percentage": {
        "type": "number",
        "description": "Score percentage",
        "default": 0
      },
      "passed": {
        "type": "boolean",
        "description": "Whether the attempt passed",
        "default": false
      }
    },
    "required": [
      "user_id",
      "type"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "create": {
        "data.user_id": "{{user.id}}"
      },
      "update": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "delete": {
        "$or": [
          {
            "data.user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      }
    }
  },
  "ReviewSchedule": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "flashcard_id": {
        "type": "string",
        "description": "Flashcard id"
      },
      "lesson_id": {
        "type": "string",
        "description": "Lesson id"
      },
      "course_id": {
        "type": "string",
        "description": "Course id"
      },
      "ease_factor": {
        "type": "number",
        "description": "SM-2 ease factor",
        "default": 2.5
      },
      "interval_days": {
        "type": "number",
        "description": "Current interval in days",
        "default": 0
      },
      "reps": {
        "type": "number",
        "description": "Number of successful repetitions",
        "default": 0
      },
      "due_date": {
        "type": "string",
        "format": "date",
        "description": "Next review date"
      },
      "last_reviewed": {
        "type": "string",
        "format": "date",
        "description": "Date last reviewed"
      }
    },
    "required": [
      "user_id",
      "flashcard_id"
    ],
    "rls": {
      "read": {
        "data.user_id": "{{user.id}}"
      },
      "create": {
        "data.user_id": "{{user.id}}"
      },
      "update": {
        "data.user_id": "{{user.id}}"
      },
      "delete": {
        "data.user_id": "{{user.id}}"
      }
    }
  }
};

export const ENTITY_NAMES = Object.keys(ENTITIES);
