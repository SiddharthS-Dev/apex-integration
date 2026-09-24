import { createClientFromRequest } from '@base44/sdk';
import { json, errorResponse } from '../../shared/dropboxClient.ts';

/**
 * Records a view: totals, unique viewers, online vs offline, rolling 60-day
 * breakdown, running averages for reading time and completion, and the trend
 * score that drives the "Trending" shelves.
 */

const WINDOW_DAYS = 60;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function viewsWithin(breakdown: Array<{ date: string; count: number }>, days: number): number {
  const cutoff = Date.now() - days * 86400000;
  return breakdown.reduce(
    (sum, d) => (new Date(d.date).getTime() >= cutoff ? sum + (d.count ?? 0) : sum),
    0
  );
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) return json({ error: 'Authentication required.' }, 401);

    const payload = await req.json().catch(() => ({}));
    const presentationId = payload.presentation_id;
    if (!presentationId) return json({ error: 'presentation_id is required.' }, 400);

    const source = payload.source === 'offline' ? 'offline' : 'online';
    const readingTime = Math.max(0, Number(payload.reading_time_secs ?? 0));
    const completion = Math.max(0, Math.min(100, Number(payload.completion_pct ?? 0)));

    const presentation = await base44.asServiceRole.entities.Presentation.get(presentationId);
    if (!presentation) return json({ error: 'Presentation not found.' }, 404);

    const existing = await base44.asServiceRole.entities.PresentationAnalytics.filter({
      presentation_id: presentationId,
    });

    const record =
      existing?.[0] ??
      (await base44.asServiceRole.entities.PresentationAnalytics.create({
        presentation_id: presentationId,
        presentation_title: presentation.title,
        total_views: 0,
        unique_views: 0,
        viewer_ids: [],
        online_views: 0,
        offline_views: 0,
        avg_reading_time: 0,
        completion_pct: 0,
        bookmarks: 0,
        favorites: 0,
        trend_score: 0,
        daily_breakdown: [],
      }));

    /* ---- unique viewers ---- */
    const viewerIds: string[] = Array.isArray(record.viewer_ids) ? [...record.viewer_ids] : [];
    const isNewViewer = !viewerIds.includes(user.id);
    if (isNewViewer) viewerIds.push(user.id);

    /* ---- rolling daily breakdown ---- */
    const breakdown: Array<{ date: string; count: number }> = Array.isArray(record.daily_breakdown)
      ? record.daily_breakdown.map((d: any) => ({ ...d }))
      : [];
    const key = todayKey();
    const today = breakdown.find((d) => d.date === key);
    if (today) today.count += 1;
    else breakdown.push({ date: key, count: 1 });

    const cutoff = Date.now() - WINDOW_DAYS * 86400000;
    const trimmed = breakdown
      .filter((d) => new Date(d.date).getTime() >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));

    /* ---- running averages ---- */
    const totalViews = (record.total_views ?? 0) + 1;
    const avgReadingTime =
      readingTime > 0
        ? Math.round(((record.avg_reading_time ?? 0) * (totalViews - 1) + readingTime) / totalViews)
        : record.avg_reading_time ?? 0;
    const avgCompletion =
      completion > 0
        ? Math.round(((record.completion_pct ?? 0) * (totalViews - 1) + completion) / totalViews)
        : record.completion_pct ?? 0;

    /* ---- trend score: recency, growth and engagement ---- */
    const recent = viewsWithin(trimmed, 7);
    const previous = viewsWithin(trimmed, 14) - recent;
    const growth = previous > 0 ? (recent - previous) / previous : recent > 0 ? 1 : 0;
    const trendScore = Math.round(recent * 2 + growth * 30 + avgReadingTime / 60);

    await base44.asServiceRole.entities.PresentationAnalytics.update(record.id, {
      presentation_title: presentation.title,
      total_views: totalViews,
      unique_views: (record.unique_views ?? 0) + (isNewViewer ? 1 : 0),
      viewer_ids: viewerIds,
      online_views: (record.online_views ?? 0) + (source === 'online' ? 1 : 0),
      offline_views: (record.offline_views ?? 0) + (source === 'offline' ? 1 : 0),
      avg_reading_time: avgReadingTime,
      completion_pct: avgCompletion,
      last_viewed_date: new Date().toISOString(),
      last_viewed_by: user.id,
      last_viewed_by_name: user.full_name ?? user.email ?? '',
      trend_score: trendScore,
      daily_breakdown: trimmed,
    });

    // Denormalised onto the presentation so list queries can sort without a join.
    await base44.asServiceRole.entities.Presentation.update(presentationId, {
      view_count: (presentation.view_count ?? 0) + 1,
      trend_score: trendScore,
    });

    return json({ ok: true, total_views: totalViews, trend_score: trendScore });
  } catch (err) {
    return errorResponse(err);
  }
});
