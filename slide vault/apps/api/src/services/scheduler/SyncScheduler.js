/**
 * Background synchronization.
 *
 * The production path is scheduled, not manual: an administrator connects
 * Dropbox once and the library keeps itself current (spec §29).
 *
 * This is an in-process timer, which is honest about its limits — with several
 * instances every one of them ticks. What makes that safe is the advisory lock
 * in the sync service: the ticks collide, one wins, the rest return "already
 * running". For a deployment that would rather have a real job system, the
 * same `run()` entry point is what Celery, BullMQ, Quartz or a cloud scheduler
 * would call; see docs/DEPLOYMENT.md.
 */
export class SyncScheduler {
  #timer = null;
  #retention = null;
  #running = false;

  constructor({ config, sync, connections, logger, retention }) {
    this.config = config;
    this.sync = sync;
    this.connections = connections;
    this.retention = retention;
    this.logger = logger?.child?.({ component: 'SyncScheduler' }) ?? logger;
  }

  get enabled() {
    return this.config.sync.enabled;
  }

  start() {
    if (!this.enabled) {
      this.logger?.info?.('Scheduled sync is disabled (DROPBOX_SYNC_ENABLED=false).');
      return this;
    }
    if (this.#timer) return this;

    const intervalMs = Math.max(60_000, this.config.sync.intervalMinutes * 60_000);
    this.#timer = setInterval(() => {
      this.tick('scheduled').catch(() => {});
    }, intervalMs);
    // Never hold the process open for a timer — a shutdown should not wait up
    // to 30 minutes for the next tick.
    this.#timer.unref?.();

    // Retention runs daily: sync logs, audit rows, expired OAuth state and
    // cached previews all have a bounded lifetime (spec §78).
    this.#retention = setInterval(() => {
      this.retention?.().catch?.(() => {});
    }, 24 * 3600_000);
    this.#retention.unref?.();

    this.logger?.info?.('Scheduled sync started', { intervalMinutes: this.config.sync.intervalMinutes });

    if (this.config.sync.runOnStartup) {
      // Deliberately not awaited: a slow first sync must not delay the server
      // becoming able to serve requests.
      setTimeout(() => this.tick('startup').catch(() => {}), 5_000).unref?.();
    }

    return this;
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#retention) clearInterval(this.#retention);
    this.#timer = null;
    this.#retention = null;
    return this;
  }

  /** One scheduled attempt. Never throws — a failed tick must not kill the timer. */
  async tick(trigger = 'scheduled') {
    if (this.#running) {
      this.logger?.debug?.('Skipping a tick: the previous one is still running.');
      return { status: 'skipped', reason: 'in_progress' };
    }

    this.#running = true;
    try {
      const connection = await this.connections.get('dropbox');
      if (!connection?.refreshToken) {
        this.logger?.debug?.('Skipping a tick: Dropbox is not connected.');
        return { status: 'skipped', reason: 'not_connected' };
      }

      const result = await this.sync.run({ trigger });
      this.logger?.info?.('Scheduled sync finished', { status: result.status, ...result.counts });
      return result;
    } catch (error) {
      this.logger?.error?.('Scheduled sync failed', { error: error.message });
      return { status: 'error', error: error.message };
    } finally {
      this.#running = false;
    }
  }
}
