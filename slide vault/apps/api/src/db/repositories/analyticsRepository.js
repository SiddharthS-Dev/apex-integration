/**
 * View analytics — one row per presentation, created on first view.
 *
 * Kept deliberately small: it exists so the application's dashboard has real
 * numbers to show, and so "file opened by a user" is a first-class event the
 * Dropbox content service can be measured against.
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const DAILY_WINDOW_DAYS = 60;

const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value ?? '') ?? fallback;
  } catch {
    return fallback;
  }
};

export class AnalyticsRepository {
  constructor(db) {
    this.db = db;
  }

  async findByPresentation(presentationId) {
    const row = await this.db.queryOne(
      'SELECT * FROM presentation_analytics WHERE presentation_id = ?',
      [presentationId]
    );
    return row ? AnalyticsRepository.hydrate(row) : null;
  }

  async list({ limit = 200 } = {}) {
    const rows = await this.db.query(
      'SELECT * FROM presentation_analytics ORDER BY total_views DESC LIMIT ?',
      [Math.min(Number(limit) || 200, 1000)]
    );
    return rows.map(AnalyticsRepository.hydrate);
  }

  /**
   * Records one view. Runs in a transaction so two concurrent viewers cannot
   * both read total_views = 4 and both write 5.
   */
  async recordView({ presentationId, presentationTitle = '', viewerId = '', viewerName = '', offline = false, readingSeconds = 0 }) {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne(
        'SELECT * FROM presentation_analytics WHERE presentation_id = ?',
        [presentationId]
      );
      const timestamp = now();

      if (!existing) {
        await tx.execute(
          `INSERT INTO presentation_analytics
             (id, presentation_id, presentation_title, total_views, unique_views, viewer_ids_json,
              online_views, offline_views, avg_reading_time, last_viewed_at, last_viewed_by,
              last_viewed_by_name, daily_breakdown_json, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            presentationId,
            presentationTitle,
            viewerId ? 1 : 0,
            JSON.stringify(viewerId ? [viewerId] : []),
            offline ? 0 : 1,
            offline ? 1 : 0,
            readingSeconds,
            timestamp,
            viewerId,
            viewerName,
            JSON.stringify([{ date: timestamp.slice(0, 10), count: 1 }]),
            timestamp,
            timestamp,
          ]
        );
        return this.findByPresentation(presentationId);
      }

      const viewers = new Set(parseJson(existing.viewer_ids_json, []));
      if (viewerId) viewers.add(viewerId);

      const totalViews = Number(existing.total_views) + 1;
      const avgReading = readingSeconds
        ? (Number(existing.avg_reading_time) * Number(existing.total_views) + readingSeconds) / totalViews
        : Number(existing.avg_reading_time);

      const today = timestamp.slice(0, 10);
      const cutoff = new Date(Date.now() - DAILY_WINDOW_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
      const daily = parseJson(existing.daily_breakdown_json, []).filter((entry) => entry.date >= cutoff);
      const todayEntry = daily.find((entry) => entry.date === today);
      if (todayEntry) todayEntry.count += 1;
      else daily.push({ date: today, count: 1 });

      // Recent momentum, not lifetime popularity — a deck viewed 100 times two
      // years ago should not outrank one that is being read this week.
      const recent = daily
        .filter((entry) => entry.date >= new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10))
        .reduce((sum, entry) => sum + entry.count, 0);
      const trendScore = recent * 2 + avgReading / 60;

      await tx.execute(
        `UPDATE presentation_analytics SET
           presentation_title = ?, total_views = ?, unique_views = ?, viewer_ids_json = ?,
           online_views = ?, offline_views = ?, avg_reading_time = ?, trend_score = ?,
           daily_breakdown_json = ?, last_viewed_at = ?, last_viewed_by = ?, last_viewed_by_name = ?,
           updated_at = ?
         WHERE presentation_id = ?`,
        [
          presentationTitle || existing.presentation_title,
          totalViews,
          viewers.size,
          JSON.stringify([...viewers]),
          Number(existing.online_views) + (offline ? 0 : 1),
          Number(existing.offline_views) + (offline ? 1 : 0),
          avgReading,
          trendScore,
          JSON.stringify(daily),
          timestamp,
          viewerId || existing.last_viewed_by,
          viewerName || existing.last_viewed_by_name,
          timestamp,
          presentationId,
        ]
      );

      await tx.execute('UPDATE stored_file SET trend_score = ? WHERE id = ?', [trendScore, presentationId]);
      return this.findByPresentation(presentationId);
    });
  }

  static hydrate(row) {
    return {
      ...row,
      total_views: Number(row.total_views ?? 0),
      unique_views: Number(row.unique_views ?? 0),
      online_views: Number(row.online_views ?? 0),
      offline_views: Number(row.offline_views ?? 0),
      avg_reading_time: Number(row.avg_reading_time ?? 0),
      completion_pct: Number(row.completion_pct ?? 0),
      trend_score: Number(row.trend_score ?? 0),
      viewer_ids: parseJson(row.viewer_ids_json, []),
      daily_breakdown: parseJson(row.daily_breakdown_json, []),
    };
  }
}
