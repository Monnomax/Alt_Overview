import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";
import { OverviewChromeController } from "./src/overviewChromeController.js";
import { AppGridController } from "./src/appGridController.js";
import { AppGridLayoutController } from "./src/appGridLayoutController.js";
import { DndManager } from "./src/dndManager.js";
//import { AppGridOrderController } from "./src/appGridOrderController.js";
import { BackgroundController } from "./src/backgroundController.js";
import { DesktopWallpaperEffectsController } from "./src/desktopWallpaperEffectsController.js";
import { IconInteractionController } from "./src/iconInteractionController.js";
import { LayoutController } from "./src/layoutController.js";
import { ScrollController } from "./src/scrollController.js";
import { WorkspacesController } from "./src/workspacesController.js";
import { WindowPreviewController } from "./src/windowPreviewController.js";
import CloseOverviewController from "./src/closeOverviewController.js";
import { Diagnostics } from "./src/diagnostics.js";

export default class OverviewBackgroundExtension extends Extension {
    enable() {
        this._diagnostics = new Diagnostics(this);
        this._preserveFailureSnapshot = false;

        try {
            this._settings = this.getSettings();
            this._diagnostics.setSettings(this._settings);
            this._diagnostics.event("lifecycle", "Extension enable started", {
                shellVersion: Config.PACKAGE_VERSION,
            });
            this._saveRuntimeState("enable-started");

            this._migrateWorkspaceSize();
            this._migrateSearchEntryMode();

            // Desktop wallpaper effects must remain active even before the
            // user opens Overview for the first time.
            this._desktopWallpaperEffectsController =
                new DesktopWallpaperEffectsController(
                    this._settings,
                    this._diagnostics,
                );
            this._enableComponent(
                "desktop-wallpaper-effects",
                this._desktopWallpaperEffectsController,
            );

            this._closeOverviewController = new CloseOverviewController(
                this._settings,
            );
            this._closeOverviewController.enable();
            this._diagnostics.event(
                "controller",
                "Close overview controller enabled",
            );

            /*
             * GNOME emits "showing" after prepareToEnterOverview() and directly
             * before animateToOverview().  At this point AppDisplay still has
             * not been made visible by OverviewControls.
             *
             * Activate synchronously here.  Do NOT use idle_add(): doing so lets
             * GNOME render the native AppGrid before our layout patch is installed.
             */
            this._overviewShowingId = Main.overview.connect("showing", () => {
                this._runSafely("overview", "Handle showing event", () => {
                    this._diagnostics?.event("overview", "Overview showing event");
                    this._saveRuntimeState("overview-showing");

                    if (this._active) {
                        if (this._refreshRuntimeReferences())
                            this._runSafely("layout", "Refresh layout", () =>
                                this._layoutController?.update(),
                            );
                    } else {
                        this._activate();
                    }
                });
            });

            this._diagnostics.event("lifecycle", "Overview signal connected", {
                signalId: this._overviewShowingId,
            });
            this._overviewHiddenId = Main.overview.connect("hidden", () => {
                this._diagnostics?.event("overview", "Overview hidden event");
                this._saveRuntimeState("overview-hidden");
            });
            this._diagnostics.event("lifecycle", "Overview hidden signal connected", {
                signalId: this._overviewHiddenId,
            });

            // Manual enable while Overview is already visible.
            if (Main.overview.visible) this._activate();
        } catch (error) {
            this._diagnostics.error("lifecycle", "Extension enable failed", error);
            this._saveRuntimeState("enable-failed", {
                error: String(error?.message ?? error),
            });
            this._preserveFailureSnapshot = true;
            this.disable();
        }
    }

    _refreshRuntimeReferences() {
        if (!this._settings) return false;

        const previousControls = this._controls;
        const previousLayoutManager = this._layoutManager;
        const previousSearchEntry = this._searchEntry;
        const controls = Main.overview._overview?._controls;
        const appDisplay = controls?._appDisplay ?? null;
        const workspacesDisplay = controls?._workspacesDisplay ?? null;

        if (!controls || !appDisplay) {
            const missing = {
                overview: Boolean(Main.overview._overview),
                controls: Boolean(controls),
                appDisplay: Boolean(appDisplay),
                workspacesDisplay: Boolean(workspacesDisplay),
            };
            this._diagnostics?.warning(
                "runtime",
                "Overview runtime objects are not ready",
                missing,
            );
            this._saveRuntimeState("runtime-references-unavailable", missing);
            return false;
        }

        this._searchEntry = Main.overview.searchEntry;
        this._controls = controls;
        this._layoutManager = controls.layout_manager ?? null;
        this._appDisplay = appDisplay;
        this._workspacesDisplay = workspacesDisplay;
        this._workspacesView = null;

        if (
            this._active &&
            (previousControls !== controls ||
                previousLayoutManager !== this._layoutManager ||
                previousSearchEntry !== this._searchEntry)
        ) {
            this._diagnostics?.event(
                "runtime",
                "Overview runtime objects changed",
                {
                    controlsChanged: previousControls !== controls,
                    layoutManagerChanged:
                        previousLayoutManager !== this._layoutManager,
                    searchEntryChanged:
                        previousSearchEntry !== this._searchEntry,
                },
            );
            this._disableComponent("layout", this._layoutController);
            this._layoutController = null;
            this._runSafely("layout", "Recreate layout controller", () => {
                this._layoutController = new LayoutController(
                    this._settings,
                    this._layoutManager,
                    this._searchEntry,
                );
                this._enableComponent("layout", this._layoutController);
            });
        }

        this._saveRuntimeState("runtime-references-ready");
        return true;
    }

    _activate() {
        const settings = this._settings;
        if (!settings || this._active) return;

        if (!this._refreshRuntimeReferences()) return;

        this._active = true;
        this._saveRuntimeState("activation-started");

        try {
            const searchEntry = this._searchEntry;
            const layoutManager = this._layoutManager;
            const appDisplay = this._appDisplay;
            const workspacesDisplay = this._workspacesDisplay;

            this._overviewChromeController = new OverviewChromeController(settings);
            this._backgroundController = new BackgroundController(
                settings,
                this._diagnostics,
            );
            this._layoutController = new LayoutController(
                settings,
                layoutManager,
                searchEntry,
            );
            this._workspacesController = new WorkspacesController(
                settings,
                null,
                workspacesDisplay,
            );
            this._appGridController = new AppGridController(settings, appDisplay);
            this._dndManager = new DndManager(appDisplay, this._diagnostics);
            //this._appGridOrderController = new AppGridOrderController(
            //    settings,
            //    appDisplay,
            //);
            this._iconController = new IconInteractionController(
                settings,
                appDisplay,
            );
            this._appGridLayoutController = new AppGridLayoutController(
                settings,
                appDisplay,
                this._iconController,
                this._diagnostics,
            );
            this._scrollController = new ScrollController(
                settings,
                appDisplay,
                workspacesDisplay,
                (step) => this._appGridController.goToPage(step),
            );
            this._windowPreviewController = new WindowPreviewController(
                settings,
                this._diagnostics,
            );

            /* Dependencies are enabled from lower level to higher level. */
            this._enableComponent("overview-chrome", this._overviewChromeController);
            this._enableComponent("background", this._backgroundController);
            this._enableComponent("layout", this._layoutController);
            this._enableComponent("workspaces", this._workspacesController);
            this._enableComponent("app-grid", this._appGridController);
            this._enableComponent("dnd", this._dndManager);
            this._runSafely("app-grid", "Update icon names visibility", () =>
                this._iconController.updateNamesVisibility(),
            );
            this._enableComponent("app-grid-layout", this._appGridLayoutController);
            this._enableComponent("scroll", this._scrollController);
            this._enableComponent("window-preview", this._windowPreviewController);

            const applySettings = () => {
                if (!this._active) return;

                this._runSafely("settings", "Apply settings", () => {
                    this._backgroundController?.setVisible(
                        settings.get_boolean("enabled"),
                    );
                    this._backgroundController?.applySettings();
                    this._layoutController?.update();
                    this._workspacesController?.updateOrientation();
                    this._appGridController?.updateOrientation();
                    this._appDisplay?._grid?.queue_relayout();
                });
            };

            this._settingsChangedId = settings.connect(
                "changed",
                (_settings, key) => {
                    if (
                        key === "diagnostics-last-runtime-state" ||
                        key === "diagnostics-last-error"
                    )
                        return;

                    this._diagnostics?.event("settings", "Setting changed", {
                        key,
                    });
                    if (key !== "diagnostics-level")
                        this._saveRuntimeState("settings-changed", { key });
                    applySettings();
                },
            );
            this._appGridShowNamesChangedId = settings.connect(
                "changed::app-grid-names-visibility",
                () =>
                    this._runSafely(
                        "app-grid",
                        "Update icon names visibility",
                        () => this._iconController?.updateNamesVisibility(),
                    ),
            );

            this._diagnostics.event("lifecycle", "Extension activated");
            this._saveRuntimeState("active");
            applySettings();

            /*
             * Use AppDisplay's own deferred-work queue. GNOME 50 creates
             * _redisplayWorkId during AppDisplay construction specifically for
             * this job. This avoids forcing _redisplay() inside Overview's
             * "showing" callback.
             */
            if (appDisplay?._redisplayWorkId) {
                this._diagnostics.event(
                    "app-grid",
                    "Queue AppGrid redisplay",
                    { workId: appDisplay._redisplayWorkId },
                    "verbose",
                );
                Main.queueDeferredWork(appDisplay._redisplayWorkId);
            } else {
                this._diagnostics?.warning(
                    "app-grid",
                    "AppGrid redisplay work id is unavailable",
                );
            }
        } catch (error) {
            this._diagnostics.error("lifecycle", "Extension activation failed", error);
            this._saveRuntimeState("activation-failed", {
                error: String(error?.message ?? error),
            });
            this._preserveFailureSnapshot = true;
            this.disable();
        }
    }

    _enableComponent(name, controller) {
        this._diagnostics?.event("controller", `Enable ${name} started`, {}, "verbose");
        controller.enable();
        this._diagnostics?.event("controller", `Enable ${name} completed`);
    }

    _disableComponent(name, controller) {
        if (!controller) return;

        try {
            controller.disable();
            this._diagnostics?.event(
                "controller",
                `Disable ${name} completed`,
                {},
                "verbose",
            );
        } catch (error) {
            this._diagnostics?.error("controller", `Disable ${name} failed`, error);
        }
    }

    _runSafely(area, name, callback) {
        try {
            return callback();
        } catch (error) {
            this._diagnostics?.error(area, `${name} failed`, error);
            return undefined;
        }
    }

    _saveRuntimeState(event, details = {}) {
        try {
            const monitors = Main.layoutManager.monitors ?? [];
            const state = {
                event,
                active: Boolean(this._active),
                overviewVisible: Boolean(Main.overview.visible),
                runtimeObjects: {
                    controls: Boolean(this._controls),
                    layoutManager: Boolean(this._layoutManager),
                    searchEntry: Boolean(this._searchEntry),
                    appDisplay: Boolean(this._appDisplay),
                    workspacesDisplay: Boolean(this._workspacesDisplay),
                },
                controllers: {
                    background: Boolean(this._backgroundController),
                    desktopWallpaperEffects: Boolean(
                        this._desktopWallpaperEffectsController,
                    ),
                    layout: Boolean(this._layoutController),
                    workspaces: Boolean(this._workspacesController),
                    appGrid: Boolean(this._appGridController),
                    dnd: Boolean(this._dndManager),
                    iconInteraction: Boolean(this._iconController),
                    scrolling: Boolean(this._scrollController),
                    windowPreview: Boolean(this._windowPreviewController),
                },
                monitors: monitors.map(({ x, y, width, height }) => ({
                    x,
                    y,
                    width,
                    height,
                })),
                settings: this._settings
                    ? {
                          enabled: this._settings.get_boolean("enabled"),
                          applyToWallpaper: this._settings.get_boolean(
                              "apply-to-wallpaper",
                          ),
                          brightness: this._settings.get_int("brightness"),
                          blur: this._settings.get_int("blur"),
                          saturation: this._settings.get_double("saturation"),
                          grain: this._settings.get_int("grain"),
                          searchEntryMode:
                              this._settings.get_string("search-entry-mode"),
                      }
                    : {},
                ...details,
            };
            this._diagnostics?.setRuntimeState(state);
        } catch (error) {
            this._diagnostics?.error("diagnostics", "Runtime snapshot failed", error);
        }
    }

    disable() {
        /*
         * Prevent settings callbacks from observing half-torn-down
         * controllers while we restore GNOME's native state.
         */
        const wasActive = this._active;
        this._active = false;

        this._diagnostics?.event("lifecycle", "Extension disable started", {
            wasActive,
        });

        this._disableComponent(
            "desktop-wallpaper-effects",
            this._desktopWallpaperEffectsController,
        );
        this._desktopWallpaperEffectsController = null;

        this._disableComponent("close-overview", this._closeOverviewController);
        this._closeOverviewController = null;

        if (this._overviewShowingId) {
            this._runSafely("lifecycle", "Disconnect overview signal", () =>
                Main.overview.disconnect(this._overviewShowingId),
            );
            this._overviewShowingId = 0;
        }
        if (this._overviewHiddenId) {
            this._runSafely("lifecycle", "Disconnect overview hidden signal", () =>
                Main.overview.disconnect(this._overviewHiddenId),
            );
            this._overviewHiddenId = 0;
        }

        if (this._settingsChangedId && this._settings) {
            this._runSafely("lifecycle", "Disconnect settings signal", () =>
                this._settings.disconnect(this._settingsChangedId),
            );
            this._settingsChangedId = 0;
        }

        if (this._appGridShowNamesChangedId && this._settings) {
            this._runSafely("lifecycle", "Disconnect AppGrid settings signal", () =>
                this._settings.disconnect(this._appGridShowNamesChangedId),
            );
            this._appGridShowNamesChangedId = 0;
        }

        this._disableComponent("overview-chrome", this._overviewChromeController);
        this._disableComponent("window-preview", this._windowPreviewController);
        this._disableComponent("scroll", this._scrollController);
        this._disableComponent("app-grid-layout", this._appGridLayoutController);
        this._disableComponent("icon-interaction", this._iconController);
        this._disableComponent("dnd", this._dndManager);
        //this._appGridOrderController?.disable();
        this._disableComponent("app-grid", this._appGridController);
        this._disableComponent("workspaces", this._workspacesController);
        this._disableComponent("layout", this._layoutController);
        this._disableComponent("background", this._backgroundController);

        this._scrollController = null;
        this._windowPreviewController = null;
        this._overviewChromeController = null;
        this._appGridLayoutController = null;
        this._iconController = null;
        this._dndManager = null;
        this._appGridController = null;
        this._appGridOrderController = null;
        this._workspacesController = null;
        this._layoutController = null;
        this._backgroundController = null;
        this._searchEntry = null;
        this._controls = null;
        this._layoutManager = null;
        this._appDisplay = null;
        this._workspacesDisplay = null;
        this._workspacesView = null;
        if (!this._preserveFailureSnapshot)
            this._saveRuntimeState("disabled", { wasActive });
        this._settings = null;
        this._diagnostics?.event("lifecycle", "Extension disabled", { wasActive });
        this._diagnostics = null;
    }

    _migrateWorkspaceSize() {
        if (this._settings.get_boolean("workspace-size-migrated")) return;

        const oldSize = this._settings.get_int("workspace-size");

        if (oldSize !== 0) {
            const newSize = Math.max(-100, Math.min(100, (oldSize - 100) * 5));
            this._settings.set_int("workspace-size", newSize);
            this._diagnostics?.event("migration", "Workspace size migrated", {
                from: oldSize,
                to: newSize,
            });
        }

        this._settings.set_boolean("workspace-size-migrated", true);
    }

    _migrateSearchEntryMode() {
        if (this._settings.get_boolean("search-entry-mode-migrated")) return;

        if (!this._settings.get_boolean("show-search-entry")) {
            this._settings.set_string("search-entry-mode", "never");
            this._diagnostics?.event(
                "migration",
                "Search entry mode migrated",
                { to: "never" },
            );
        }

        this._settings.set_boolean("search-entry-mode-migrated", true);
    }
}
