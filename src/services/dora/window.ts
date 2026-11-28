import { MeasurementWindow } from "./fourKeys";

/** Reporting on a decade of delivery is a mistake, not a query. */
export const MAX_WINDOW_DAYS = 3650;
export const DEFAULT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The measurement window covering the `days` up to `to`. */
export function windowEndingAt(to: Date, days: number): MeasurementWindow {
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}
