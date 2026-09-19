-- PostgreSQL schema for the Inspironics Innovation Showcase
DROP TABLE IF EXISTS infographics;

CREATE TABLE infographics (
  id            SERIAL PRIMARY KEY,
  file          TEXT UNIQUE NOT NULL,   -- original image filename
  thumb         TEXT NOT NULL,          -- thumbs/<name>.webp
  full          TEXT NOT NULL,          -- full/<name>.webp
  category      TEXT NOT NULL,
  tag           TEXT,
  title         TEXT NOT NULL,
  w             INT,
  h             INT,
  tech          TEXT[] NOT NULL DEFAULT '{}',
  esg           BOOLEAN NOT NULL DEFAULT false,
  ai            BOOLEAN NOT NULL DEFAULT false,
  iot           BOOLEAN NOT NULL DEFAULT false,
  objective     TEXT,
  flow          TEXT[] NOT NULL DEFAULT '{}',
  components    TEXT[] NOT NULL DEFAULT '{}',
  architecture  TEXT,
  bizben        TEXT[] NOT NULL DEFAULT '{}',
  techben       TEXT[] NOT NULL DEFAULT '{}',
  takeaway      TEXT,
  flagship      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_infographics_category ON infographics(category);
CREATE INDEX idx_infographics_tech ON infographics USING GIN(tech);
CREATE INDEX idx_infographics_flags ON infographics(esg, ai, iot);
