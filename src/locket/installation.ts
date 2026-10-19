// US-001: the installation's defaults. The owner chooses the US time zone new
// agreements inherit (when no zone is given and the contracting entity names
// none) and whether notice deadlines on a weekend or US federal holiday roll to
// the previous business day. Switching the option re-dates every undecided
// renewal's stored deadline in the same batch; decided renewals keep theirs.
import { may, requireRole } from './access'
import { defaultZone, noticeDeadlineFor, usZones } from './business-days'
import type { Ctx, Handler } from './commands'
import { bool, fail, integer, oneOf, sql } from './model'

export interface InstallationSettings { timezone: string; rollNoticeDeadlines: boolean; version: number }

export async function installationSettings(db: D1Database): Promise<InstallationSettings> {
  const row = await db.prepare('SELECT timezone, roll_notice_deadlines, version FROM lk_installation_settings WHERE id=?').bind('installation').first<{ timezone: string; roll_notice_deadlines: number; version: number }>()
  return row ? { timezone: row.timezone, rollNoticeDeadlines: row.roll_notice_deadlines === 1, version: row.version } : { timezone: defaultZone, rollNoticeDeadlines: false, version: 0 }
}

const saveSettings: Handler = async (c: Ctx, p) => {
  requireRole(c.actor, may.manageRoles, 'change installation defaults')
  const zone = oneOf(p, 'timezone', usZones), roll = bool(p, 'rollNoticeDeadlines'), version = integer(p, 'version', 0)
  const current = await installationSettings(c.db)
  if (current.version !== version) fail('STALE', 'Installation defaults changed since you loaded them. Reload before editing.', 409)
  const writes = [sql(`INSERT INTO lk_installation_settings VALUES('installation',?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET timezone=excluded.timezone,
    roll_notice_deadlines=excluded.roll_notice_deadlines, updated_by=excluded.updated_by, updated_at=excluded.updated_at, version=lk_installation_settings.version+1`, zone, roll ? 1 : 0, c.actor.id, c.now)]
  let moved = 0
  if (roll !== current.rollNoticeDeadlines) {
    const open = (await c.db.prepare('SELECT id, end_date, notice_days, deadline_date, timezone FROM lk_renewals WHERE decision IS NULL').all<{ id: string; end_date: string; notice_days: number; deadline_date: string; timezone: string }>()).results
    for (const r of open) {
      const next = noticeDeadlineFor(r.end_date, r.notice_days, r.timezone, roll)
      if (next.date === r.deadline_date) continue
      moved++
      writes.push(sql('UPDATE lk_renewals SET deadline_date=?, deadline_at=?, updated_at=? WHERE id=? AND decision IS NULL AND deadline_date=?', next.date, next.at, c.now, r.id, r.deadline_date))
    }
  }
  return {
    allowed: may.manageRoles,
    result: { timezone: zone, rollNoticeDeadlines: roll, version: version + 1, moved },
    writes,
    checks: [version ? sql("(SELECT version FROM lk_installation_settings WHERE id='installation')=?", version) : sql("NOT EXISTS(SELECT 1 FROM lk_installation_settings WHERE id='installation')")],
    audit: [{ action: 'installation.settings', summary: `Installation defaults: time zone ${zone}; notice deadlines ${roll ? 'roll back to the previous US business day' : 'stay on their calendar date'}${moved ? `; ${moved} open notice deadline${moved === 1 ? '' : 's'} re-dated` : ''}.` }],
  }
}

export const installationHandlers: Record<string, Handler> = { 'installation.settings': saveSettings }
