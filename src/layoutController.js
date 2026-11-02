import { ControlsLayoutPatch } from "./controlsLayoutPatch.js";
import { OverviewTopBar } from "./overviewTopBar.js";
import { WorkspaceOccupancyTracker } from "./workspaceOccupancyTracker.js";

export class LayoutController {
    constructor(settings, layoutManager, searchEntry) {
        this._settings = settings;
        this._layoutManager = layoutManager;
        this._searchEntry = searchEntry;
        this._searchEntryModeChangedId = 0;
        this._searchEntryTextChangedId = 0;

        this._workspaceOccupancy = new WorkspaceOccupancyTracker(() =>
            this.update(),
        );
        this._topBar = new OverviewTopBar(layoutManager, searchEntry);
        this._controlsLayoutPatch = null;
    }

    enable() {
        this._searchEntryModeChangedId = this._settings.connect(
            "changed::search-entry-mode",
            () => this.update(),
        );

        const clutterText = this._searchEntry?.clutter_text;
        if (clutterText) {
            this._searchEntryTextChangedId = clutterText.connect(
                "text-changed",
                () => this.update(),
            );
        }

        if (!this._topBar.create()) {
            this._topBar.updateSearchEntry(
                this._shouldShowSearchEntry(),
            );
            return;
        }

        this._controlsLayoutPatch = new ControlsLayoutPatch(
            this._settings,
            this._layoutManager,
            this._topBar.controls,
            () => this._workspaceOccupancy.hasWindowsOnMultipleWorkspaces,
        );
        this._controlsLayoutPatch.enable();
        this._workspaceOccupancy.enable();
        this.update();
    }

    disable() {
        this._workspaceOccupancy.disable();

        if (this._searchEntryModeChangedId) {
            this._settings.disconnect(this._searchEntryModeChangedId);
            this._searchEntryModeChangedId = 0;
        }

        if (this._searchEntryTextChangedId) {
            try {
                this._searchEntry.clutter_text.disconnect(
                    this._searchEntryTextChangedId,
                );
            } catch (_error) {
                // The search entry may already have been destroyed.
            }
            this._searchEntryTextChangedId = 0;
        }

        this._controlsLayoutPatch?.disable();
        this._controlsLayoutPatch = null;
        this._topBar.destroy();
    }

    update() {
        const hasMultipleWorkspaces = this._workspaceOccupancy.refresh();
        const showSearchEntry = this._shouldShowSearchEntry();
        const showThumbnails = this._settings.get_boolean(
            "show-workspaces-thumbnails",
        );

        this._topBar.updateSearchEntry(showSearchEntry);
        this._controlsLayoutPatch?.updateThumbnailsBox();
        this._topBar.setVisible(
            showSearchEntry || (showThumbnails && hasMultipleWorkspaces),
        );
        this._layoutManager?.layout_changed();
    }

    _shouldShowSearchEntry() {
        const mode = this._settings.get_string("search-entry-mode");
        if (mode === "always")
            return true;
        if (mode === "never")
            return false;

        return (this._searchEntry?.get_text?.() ?? "").trim().length > 0;
    }
}
