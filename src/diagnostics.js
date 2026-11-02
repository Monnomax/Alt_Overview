import GLib from "gi://GLib";

const LEVELS = {
    off: 0,
    errors: 1,
    normal: 2,
    verbose: 3,
};

export class Diagnostics {
    constructor(extension) {
        this._extension = extension;
        this._settings = null;
        this._sessionId = GLib.uuid_string_random();
        this._sequence = 0;
    }

    setSettings(settings) {
        this._settings = settings;
    }

    event(area, name, details = {}, level = "normal") {
        if (!this._isEnabled(level)) return;

        const record = this._record(area, name, details);
        console.log(`${this._prefix("INFO", area)} ${JSON.stringify(record)}`);
    }

    warning(area, name, details = {}) {
        if (!this._isEnabled("normal")) return;

        const record = this._record(area, name, details);
        console.warn(`${this._prefix("WARN", area)} ${JSON.stringify(record)}`);
    }

    error(area, name, error, details = {}) {
        if (!this._isEnabled("errors")) return;

        const message = error?.message ?? String(error);
        const stack = error?.stack ?? null;
        const record = this._record(area, name, details);
        console.error(
            `${this._prefix("ERROR", area)} ${JSON.stringify({
                ...record,
                error: { message, stack },
            })}`,
        );

        try {
            this._settings?.set_string(
                "diagnostics-last-error",
                JSON.stringify({
                    time: record.time,
                    area,
                    event: name,
                    message: String(error?.message ?? error).slice(0, 500),
                }),
            );
        } catch (_settingsError) {
            // The journal remains the source of the full diagnostic record.
        }
    }

    setRuntimeState(state) {
        try {
            this._settings?.set_string(
                "diagnostics-last-runtime-state",
                JSON.stringify({
                    time: new Date().toISOString(),
                    session: this._sessionId,
                    ...state,
                }),
            );
        } catch (error) {
            this.error("diagnostics", "Could not save runtime snapshot", error);
        }
    }

    _isEnabled(level) {
        if (!this._settings) return level === "errors";

        try {
            const configuredLevel = this._settings.get_string("diagnostics-level");
            return (LEVELS[configuredLevel] ?? LEVELS.errors) >= LEVELS[level];
        } catch (_error) {
            return level === "errors";
        }
    }

    _record(area, name, details) {
        return {
            time: new Date().toISOString(),
            session: this._sessionId,
            sequence: ++this._sequence,
            extensionVersion: this._extension.metadata.version,
            event: name,
            details,
        };
    }

    _prefix(level, area) {
        return `[alt-overview][${level}][${area}]`;
    }
}
