// A loaded space seen through the app's own read rules (src/domain/lists.ts): live documents
// (no tombstones) as Maps, today and the current place, settings with their defaults. Built lazily,
// so a tool that only needs tasks never touches sessions.
import type { Day, Decision, Place, Project, Session, Stay, Task } from '../../../src/data/schema';
import { fieldsOf } from '../../../src/data/doc';
import { normDecision } from '../../../src/data/normalize';
import { withDefaults, type Settings } from '../../../src/data/settings';
import { whereNow } from '../../../src/domain/places';
import type { Data } from '../../../src/domain/lists';
import type { Snapshot } from '../../../src/ai/apply';
import type { Collection } from '../../../src/data/schema';
import type { Maps } from './space';

type W<T> = T & { id: string };

export class View {
  private cache = new Map<string, Map<string, unknown>>();
  constructor(readonly maps: Maps, readonly at: Date = new Date()) {}

  private live<T>(c: Collection, map?: (d: Record<string, unknown>) => T): Map<string, W<T>> {
    let m = this.cache.get(c) as Map<string, W<T>> | undefined;
    if (!m) {
      m = new Map();
      for (const d of this.maps[c].values()) {
        if (d._del) continue;
        // The stored document itself serves as the typed one: the extra bookkeeping keys are harmless to the rules.
        m.set(d.id, map ? { ...map(fieldsOf(d) as Record<string, unknown>), id: d.id } as W<T> : (d as unknown as W<T>));
      }
      this.cache.set(c, m);
    }
    return m;
  }

  get tasks() { return this.live<Task>('tasks'); }
  get sessions() { return this.live<Session>('sessions'); }
  get projects() { return this.live<Project>('projects'); }
  get days() { return this.live<Day>('days'); }
  get places() { return this.live<Place>('places'); }
  get stays() { return this.live<Stay>('stays'); }
  get decisions() { return this.live<Decision>('decisions', normDecision); }

  get settings(): Settings {
    const d = this.maps.meta.get('settings');
    return withDefaults(d && !d._del ? (fieldsOf(d) as Partial<Settings>) : undefined);
  }

  /** Today (day-start rule, in the current place's time zone) and the place the person is in. */
  get where() {
    const s = this.settings;
    return whereNow(this.at, { here: s.here, dayStart: s.dayStart }, id => this.places.get(id)?.timeZone, this.stays.values());
  }
  get today() { return this.where.today; }
  get zone(): string { return this.places.get(this.where.here)?.timeZone ?? 'UTC'; }

  get data(): Data {
    return { today: this.today, urgencyDays: this.settings.urgencyDays, tasks: this.tasks, sessions: this.sessions, projects: this.projects, days: this.days, decisions: this.decisions, places: this.places, stays: this.stays };
  }

  /** What the change-set planner checks a change-set against. */
  snapshot(): Snapshot {
    return { today: this.today, tasks: this.tasks, projects: this.projects, days: this.days, decisions: this.decisions, places: this.places, stays: this.stays };
  }
}
