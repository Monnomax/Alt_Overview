import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class OverviewChromeController {
    constructor(settings) {
        this._settings = settings;

        this._settingsChangedIds = [];
        this._overviewShowingId = 0;
        this._overviewHiddenId = 0;

        this._panelHidden = false;
        this._dashHidden = false;

        this._dash = null;
        this._originalDashGetPreferredHeight = null;
    }

    enable() {
        this._settingsChangedIds.push(
            this._settings.connect("changed::show-panel-in-overview", () =>
                this._update(),
            ),
        );

        this._settingsChangedIds.push(
            this._settings.connect("changed::show-dash-in-overview", () =>
                this._update(),
            ),
        );

        this._overviewShowingId = Main.overview.connect("showing", () =>
            this._update(),
        );

        this._overviewHiddenId = Main.overview.connect("hidden", () =>
            this._restore(),
        );

        this._update();
    }

    disable() {
        for (const id of this._settingsChangedIds)
            this._settings.disconnect(id);

        this._settingsChangedIds = [];

        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
        }

        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }

        this._restore();
    }

    _update() {
        if (!Main.overview.visible) {
            this._restore();
            return;
        }

        this._updatePanel();
        this._updateDash();
    }

    _updatePanel() {
        const panel = Main.panel;
        const panelBox = Main.layoutManager?.panelBox;

        if (!panel || !panelBox) return;

        const show = this._settings.get_boolean("show-panel-in-overview");

        if (show) {
            if (!this._panelHidden) return;

            panelBox.set_height(-1);
            panel.show();

            this._panelHidden = false;
            return;
        }

        if (!this._panelHidden) {
            panel.hide();
            panelBox.set_height(0);
            panelBox.queue_relayout();

            this._panelHidden = true;
        }
    }

    _updateDash() {
        const dash = Main.overview?.dash;

        if (!dash) return;

        if (this._dash !== dash) {
            this._restoreDash();

            this._dash = dash;
        }

        const show = this._settings.get_boolean("show-dash-in-overview");

        if (show) {
            if (this._dashHidden) this._restoreDash();

            return;
        }

        if (!this._dashHidden) this._hideDash(dash);
    }

    _hideDash(dash) {
        const original = dash.get_preferred_height;

        if (typeof original === "function") {
            this._originalDashGetPreferredHeight = original;

            dash.get_preferred_height = function () {
                return [0, 0];
            };
        }

        dash.hide();
        dash.queue_relayout();
        dash.get_parent()?.queue_relayout();

        this._dashHidden = true;
    }

    _restoreDash() {
        if (!this._dash) return;

        if (this._originalDashGetPreferredHeight) {
            this._dash.get_preferred_height =
                this._originalDashGetPreferredHeight;

            this._originalDashGetPreferredHeight = null;
        }

        this._dash.show();
        this._dash.queue_relayout();
        this._dash.get_parent()?.queue_relayout();

        this._dashHidden = false;
    }

    _restore() {
        if (this._panelHidden) {
            const panel = Main.panel;
            const panelBox = Main.layoutManager?.panelBox;

            if (panelBox) panelBox.set_height(-1);

            panel?.show();

            this._panelHidden = false;
        }

        if (this._dashHidden) this._restoreDash();
    }
}
