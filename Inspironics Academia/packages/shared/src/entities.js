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
      },
      "playbook_id": {
        "type": "string",
        "description": "Source playbook id at issue time"
      },
      "playbook_version": {
        "type": "string",
        "description": "Playbook version label the learner was certified on"
      },
      "status": {
        "type": "string",
        "enum": [
          "valid",
          "recert_required",
          "expired",
          "superseded"
        ],
        "description": "Certificate standing (missing = valid, for certificates issued before recertification existed)",
        "default": "valid"
      },
      "expires_date": {
        "type": "string",
        "format": "date",
        "description": "Date the certificate lapses (empty = never)"
      },
      "superseded_by": {
        "type": "string",
        "description": "Public id of the certificate that replaced this one"
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
      },
      "category": {
        "type": "string",
        "description": "Copied from its playbook: which audiences can see the course"
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
      },
      "recert_on_change": {
        "type": "boolean",
        "description": "Require certified learners to recertify when a new version materially changes the playbook",
        "default": true
      },
      "cert_validity_months": {
        "type": "number",
        "description": "Months a certificate stays valid (0 = no expiry)",
        "default": 0
      },
      "recert_grace_days": {
        "type": "number",
        "description": "Days learners get to recertify once the updated course is published",
        "default": 30
      },
      "category": {
        "type": "string",
        "description": "Primary category key (PlaybookCategory.key, or 'unclassified'); decides which audiences see it"
      },
      "dropbox_source": {
        "type": "string",
        "description": "Which Dropbox source synced it: empty = the main playbooks folder; a category key (e.g. learning) = that category's own folder/app"
      },
      "category_source": {
        "type": "string",
        "enum": [
          "migration",
          "default",
          "manual",
          "upload"
        ],
        "description": "How the category was set: initial migration, sync default, an admin, or chosen at upload. Sync never changes a manual one."
      },
      "department": {
        "type": "string",
        "description": "Owning department, e.g. Engineering"
      },
      "tech_tags": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Technologies covered, e.g. Python, React"
      },
      "skill_level": {
        "type": "string",
        "enum": [
          "",
          "beginner",
          "intermediate",
          "advanced"
        ],
        "description": "Who it is written for"
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Secondary tags (a playbook has one primary category; tags never duplicate it)"
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
      },
      "lapses": {
        "type": "number",
        "description": "Times the card was forgotten after being learned",
        "default": 0
      },
      "last_quality": {
        "type": "number",
        "description": "Quality (0-5) of the most recent review"
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
  },
  "ReviewLog": {
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
      "quality": {
        "type": "number",
        "description": "Self-rated recall quality, 0-5 (3+ = remembered)"
      },
      "first_review": {
        "type": "boolean",
        "description": "Whether this was the card's first ever review",
        "default": false
      },
      "previous_interval": {
        "type": "number",
        "description": "Interval in days before this review",
        "default": 0
      },
      "interval_days": {
        "type": "number",
        "description": "Interval in days scheduled by this review",
        "default": 0
      },
      "reviewed_date": {
        "type": "string",
        "format": "date",
        "description": "Learner-local day of the review"
      }
    },
    "required": [
      "user_id",
      "flashcard_id",
      "quality"
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
  "Recertification": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Learner user id"
      },
      "user_name": {
        "type": "string",
        "description": "Learner name when opened"
      },
      "playbook_id": {
        "type": "string",
        "description": "Playbook the certificate covers"
      },
      "playbook_title": {
        "type": "string",
        "description": "Playbook title when opened"
      },
      "certificate_id": {
        "type": "string",
        "description": "Public id of the certificate that needs renewing"
      },
      "old_course_id": {
        "type": "string",
        "description": "Course the learner was certified on"
      },
      "new_course_id": {
        "type": "string",
        "description": "Published course to recertify on (empty until one is published)"
      },
      "reason": {
        "type": "string",
        "enum": [
          "playbook_changed",
          "expired"
        ],
        "description": "Why recertification is needed",
        "default": "playbook_changed"
      },
      "from_version": {
        "type": "string",
        "description": "Playbook version the learner was certified on"
      },
      "to_version": {
        "type": "string",
        "description": "Playbook version that triggered recertification"
      },
      "changed_chapters": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Titles of chapters added or materially changed"
      },
      "removed_chapters": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Titles of chapters removed"
      },
      "status": {
        "type": "string",
        "enum": [
          "awaiting_course",
          "pending",
          "completed",
          "waived"
        ],
        "description": "awaiting_course until the updated course is published; overdue is pending past due_date",
        "default": "awaiting_course"
      },
      "due_date": {
        "type": "string",
        "format": "date",
        "description": "Recertify by"
      },
      "completed_date": {
        "type": "string",
        "format": "date",
        "description": "Date completed or waived"
      },
      "new_certificate_id": {
        "type": "string",
        "description": "Public id of the certificate issued on completion"
      },
      "waived_reason": {
        "type": "string",
        "description": "Admin note when waived"
      }
    },
    "required": [
      "user_id",
      "playbook_id"
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
  "Notification": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "Recipient user id"
      },
      "kind": {
        "type": "string",
        "description": "Notification kind (see NOTIFICATION_KINDS)"
      },
      "title": {
        "type": "string",
        "description": "Headline"
      },
      "body": {
        "type": "string",
        "description": "Short message"
      },
      "link": {
        "type": "string",
        "description": "In-app path to open"
      },
      "read": {
        "type": "boolean",
        "description": "Whether the recipient has read it",
        "default": false
      },
      "dedupe_key": {
        "type": "string",
        "description": "Same key = same notification, never sent twice"
      }
    },
    "required": [
      "user_id",
      "kind",
      "title"
    ],
    "rls": {
      "read": {
        "data.user_id": "{{user.id}}"
      },
      "create": {
        "user_condition": {
          "role": "admin"
        }
      },
      "update": {
        "data.user_id": "{{user.id}}"
      },
      "delete": {
        "data.user_id": "{{user.id}}"
      }
    }
  },
  "NotificationPreference": {
    "properties": {
      "user_id": {
        "type": "string",
        "description": "User id"
      },
      "email_enabled": {
        "type": "boolean",
        "description": "Master switch for notification emails",
        "default": true
      },
      "review_reminders": {
        "type": "boolean",
        "description": "Daily email when flashcards are due",
        "default": true
      },
      "course_updates": {
        "type": "boolean",
        "description": "Email when new courses are published",
        "default": true
      },
      "recertification": {
        "type": "boolean",
        "description": "Email about recertification and expiring certificates",
        "default": true
      },
      "certificates": {
        "type": "boolean",
        "description": "Email when a certificate is issued",
        "default": true
      },
      "meetings": {
        "type": "boolean",
        "description": "Email when meeting notes are published",
        "default": true
      },
      "action_items": {
        "type": "boolean",
        "description": "Email about action items assigned to me, due and overdue",
        "default": true
      }
    },
    "required": [
      "user_id"
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
        "data.user_id": "{{user.id}}"
      },
      "delete": {
        "data.user_id": "{{user.id}}"
      }
    }
  },
  "Meeting": {
    "properties": {
      "title": {
        "type": "string",
        "description": "Meeting title"
      },
      "meeting_date": {
        "type": "string",
        "format": "date",
        "description": "Day the meeting took place"
      },
      "team": {
        "type": "string",
        "description": "Team the meeting belongs to: the Dropbox sub-folder it was filed in, or set by an admin"
      },
      "file_url": {
        "type": "string",
        "description": "Server-side file reference (upload:<key> or dropbox:<id>)"
      },
      "file_name": {
        "type": "string",
        "description": "Transcript file name"
      },
      "file_type": {
        "type": "string",
        "description": "docx, vtt or txt"
      },
      "file_size": {
        "type": "number",
        "description": "File size in bytes",
        "default": 0
      },
      "source": {
        "type": "string",
        "enum": [
          "upload",
          "dropbox"
        ],
        "description": "Where the transcript came from",
        "default": "upload"
      },
      "external_id": {
        "type": "string",
        "description": "Dropbox file id"
      },
      "revision": {
        "type": "string",
        "description": "Dropbox revision"
      },
      "dropbox_path": {
        "type": "string",
        "description": "Path in Dropbox"
      },
      "content_hash": {
        "type": "string"
      },
      "last_seen_at": {
        "type": "string",
        "format": "date-time"
      },
      "status": {
        "type": "string",
        "enum": [
          "uploaded",
          "processing",
          "needs_review",
          "published",
          "failed",
          "archived"
        ],
        "description": "Lifecycle: uploaded → processing → needs_review → published",
        "default": "uploaded"
      },
      "progress": {
        "type": "number",
        "default": 0
      },
      "error": {
        "type": "string"
      },
      "duration_minutes": {
        "type": "number",
        "description": "Length of the meeting"
      },
      "participants": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Speakers in the transcript"
      },
      "speaker_stats": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "[{ name, turns, words, seconds, share }] most talkative first"
      },
      "summary": {
        "type": "string",
        "description": "What the meeting covered and concluded"
      },
      "purpose": {
        "type": "string",
        "description": "Why the meeting was held"
      },
      "themes": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "Key ideas: [{ title, detail }]"
      },
      "decisions": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "[{ decision, rationale, owner }]"
      },
      "requirements": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "[{ text, type, priority, raised_by }]"
      },
      "open_questions": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "[{ question, owner }]"
      },
      "risks": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "[{ risk, impact, mitigation }]"
      },
      "analysis_method": {
        "type": "string",
        "enum": [
          "ai",
          "heuristic"
        ],
        "description": "ai = written by Claude; heuristic = keyword rules (AI off)"
      },
      "action_item_count": {
        "type": "number",
        "default": 0
      },
      "published_date": {
        "type": "string",
        "format": "date"
      },
      "briefing_status": {
        "type": "string",
        "enum": [
          "",
          "generating",
          "ready",
          "failed"
        ],
        "description": "Video briefing (generateMeetingVideo): generating → ready, or failed"
      },
      "briefing_audio_url": {
        "type": "string",
        "description": "Narration track of the video briefing (/api/media/<key>)"
      },
      "briefing_scenes": {
        "type": "string",
        "description": "JSON scenes of the video briefing: [{ start, end, title, layout, points, ..., text, captions }]"
      },
      "briefing_method": {
        "type": "string",
        "description": "ai (written by the AI) or notes (written from the meeting notes)"
      },
      "briefing_voice": {
        "type": "string",
        "description": "recorded (media provider voice-over in briefing_audio_url) or browser (read aloud by the viewer's browser)"
      },
      "briefing_generated_at": {
        "type": "string",
        "description": "When the video briefing was generated"
      },
      "briefing_error": {
        "type": "string",
        "description": "Why the last video briefing failed"
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
  "PlaybookCategory": {
    "properties": {
      "key": {
        "type": "string",
        "description": "Stable id stored on playbooks (e.g. learning, corporate, strategic)"
      },
      "label": {
        "type": "string",
        "description": "Category name, e.g. Corporate Knowledge Base"
      },
      "audience_label": {
        "type": "string",
        "description": "Who it is for, e.g. Employees & Teams"
      },
      "description": {
        "type": "string"
      },
      "audiences": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "User audiences allowed to see it: intern, employee, leadership"
      },
      "color": {
        "type": "string",
        "description": "Visual identity: teal, indigo, purple, amber, rose, sky"
      },
      "icon": {
        "type": "string",
        "description": "Icon name: graduation, building, compass, book, briefcase, shield"
      },
      "order": {
        "type": "number",
        "default": 0
      },
      "built_in": {
        "type": "boolean",
        "description": "One of the three standard categories (can be edited, not deleted)",
        "default": false
      }
    },
    "required": [
      "key",
      "label"
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
  "Team": {
    "properties": {
      "name": {
        "type": "string",
        "description": "Team name, as meetings are grouped (Meeting.team)"
      },
      "description": {
        "type": "string"
      },
      "members": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "Roster: [{ name, role: 'member' | 'sme', aliases: [other spellings in transcripts] }]"
      }
    },
    "required": [
      "name"
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
  "MeetingTranscript": {
    "properties": {
      "meeting_id": {
        "type": "string",
        "description": "Meeting id"
      },
      "segments": {
        "type": "array",
        "items": {
          "type": "object"
        },
        "description": "[{ speaker, start (seconds), text }]"
      },
      "published": {
        "type": "boolean",
        "description": "Mirrors the meeting being published",
        "default": false
      }
    },
    "required": [
      "meeting_id"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.published": true
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
  "ActionItem": {
    "properties": {
      "meeting_id": {
        "type": "string",
        "description": "Meeting id"
      },
      "meeting_title": {
        "type": "string",
        "description": "Meeting title, for lists across meetings"
      },
      "meeting_date": {
        "type": "string",
        "format": "date"
      },
      "task": {
        "type": "string",
        "description": "What has to be done"
      },
      "detail": {
        "type": "string"
      },
      "owner_name": {
        "type": "string",
        "description": "Owner as named in the meeting"
      },
      "owner_user_id": {
        "type": "string",
        "description": "Matched account, when the owner has one"
      },
      "due_date": {
        "type": "string",
        "format": "date"
      },
      "due_text": {
        "type": "string",
        "description": "The deadline as said in the meeting (\"by Friday\")"
      },
      "priority": {
        "type": "string",
        "enum": [
          "high",
          "medium",
          "low"
        ],
        "default": "medium"
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "in_progress",
          "done",
          "cancelled"
        ],
        "default": "open"
      },
      "source_quote": {
        "type": "string",
        "description": "What was said, word for word"
      },
      "source_time": {
        "type": "number",
        "description": "Seconds into the meeting"
      },
      "completed_date": {
        "type": "string",
        "format": "date"
      },
      "edited": {
        "type": "boolean",
        "description": "Changed by a person since it was generated (kept when the meeting is reprocessed)",
        "default": false
      },
      "published": {
        "type": "boolean",
        "description": "Mirrors the meeting being published",
        "default": false
      }
    },
    "required": [
      "meeting_id",
      "task"
    ],
    "rls": {
      "read": {
        "$or": [
          {
            "data.published": true
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
        "$or": [
          {
            "data.owner_user_id": "{{user.id}}"
          },
          {
            "user_condition": {
              "role": "admin"
            }
          }
        ]
      },
      "delete": {
        "user_condition": {
          "role": "admin"
        }
      }
    }
  }
};

export const ENTITY_NAMES = Object.keys(ENTITIES);
