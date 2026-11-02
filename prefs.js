import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
    ExtensionPreferences,
    gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Індекси відповідають порядку рядків у Gtk.StringList нижче.
const SCROLL_DIRECTIONS = ["vertical", "horizontal"];

// Індекси відповідають порядку рядків у Gtk.StringList нижче.
const SEARCH_ENTRY_MODES = ["always", "never", "typing"];

// Індекси відповідають порядку рядків у Gtk.StringList нижче.
const APP_GRID_NAMES_VISIBILITY = ["always", "never", "hover"];

// Індекси відповідають порядку рядків у Gtk.StringList для рядка
// "Розмір" у групі "Іконки" — значення в px застосовуються
// в extension.js (див. ICON_SIZE_PX там же).
const APP_GRID_ICON_SIZE = ["smallest", "small", "normal", "large", "largest"];

const APP_GRID_ORDER = [
    "manual",
    "name-ascending",
    "name-descending",
    "usage",
    "last-used",
];

// Індекси відповідають порядку рядків у Gtk.StringList для випадаючих
// меню кривих анімації іконок (група "Анімація").
const ICON_ANIMATION_CURVES = [
    "Back",
    "Bounce",
    "Circ",
    "Cubic",
    "Elastic",
    "Expo",
    "Linear",
    "Quad",
    "Quart",
    "Quint",
    "Sine",
];

export default class OverviewBackgroundPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        this._buildGeneralPage(window, settings);
        this._buildWorkspacesPage(window, settings);
        this._buildAppGridPage(window, settings);
        this._buildDiagnosticsPage(window, settings);
    }

    _buildDiagnosticsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Діагностика"),
            icon_name: "dialog-information-symbolic",
        });
        window.add(page);

        const loggingGroup = new Adw.PreferencesGroup({
            title: _("Журналювання"),
            description: _(
                "Події записуються в журнал GNOME Shell і допомагають відстежити послідовність роботи та причини помилок.",
            ),
        });
        page.add(loggingGroup);

        const levels = ["off", "errors", "normal", "verbose"];
        const levelRow = new Adw.ActionRow({
            title: _("Рівень подробиць"),
            subtitle: _("Докладний режим додає події переходів і стану компонентів."),
        });
        const levelDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [
                    _("Вимкнено"),
                    _("Лише помилки"),
                    _("Основні події"),
                    _("Докладний журнал"),
                ],
            }),
            valign: Gtk.Align.CENTER,
        });

        const refreshLevel = () => {
            const index = levels.indexOf(settings.get_string("diagnostics-level"));
            levelDropdown.set_selected(index >= 0 ? index : 1);
        };
        refreshLevel();
        levelDropdown.connect("notify::selected", () => {
            const value = levels[levelDropdown.selected] ?? "errors";
            if (settings.get_string("diagnostics-level") !== value)
                settings.set_string("diagnostics-level", value);
        });
        const levelChangedId = settings.connect(
            "changed::diagnostics-level",
            refreshLevel,
        );
        levelDropdown.connect("destroy", () => settings.disconnect(levelChangedId));
        levelRow.add_suffix(levelDropdown);
        loggingGroup.add(levelRow);

        const stateGroup = new Adw.PreferencesGroup({
            title: _("Поточний стан і звіт"),
            description: _(
                "Знімок містить стан розширення, доступність компонентів, параметри тла та конфігурацію моніторів.",
            ),
        });
        page.add(stateGroup);

        const stateRow = new Adw.ActionRow({
            title: _("Останній знімок стану"),
            subtitle: this._formatDiagnosticValue(
                settings.get_string("diagnostics-last-runtime-state"),
                _("Знімка ще немає — відкрийте «Огляд» після ввімкнення розширення."),
            ),
            subtitle_lines: 5,
        });
        stateGroup.add(stateRow);

        const errorRow = new Adw.ActionRow({
            title: _("Остання помилка"),
            subtitle: this._formatDiagnosticError(
                settings.get_string("diagnostics-last-error"),
            ),
            subtitle_lines: 3,
        });
        stateGroup.add(errorRow);

        const copyRow = new Adw.ActionRow({
            title: _("Звіт для підтримки"),
            subtitle: _(
                "Скопіювати версії середовища, параметри відтворення та команду для збору журналу.",
            ),
        });
        const copyButton = new Gtk.Button({
            label: _("Скопіювати звіт"),
            valign: Gtk.Align.CENTER,
        });
        copyButton.connect("clicked", () => {
            const display = Gdk.Display.get_default();
            if (!display) return;

            display.get_clipboard().set_text(
                this._buildDiagnosticsReport(settings),
            );
            copyButton.label = _("Скопійовано");
        });
        copyRow.add_suffix(copyButton);
        stateGroup.add(copyRow);

        const refreshStoredValues = () => {
            stateRow.subtitle = this._formatDiagnosticValue(
                settings.get_string("diagnostics-last-runtime-state"),
                _("Знімка ще немає — відкрийте «Огляд» після ввімкнення розширення."),
            );
            errorRow.subtitle = this._formatDiagnosticError(
                settings.get_string("diagnostics-last-error"),
            );
        };
        const stateChangedId = settings.connect(
            "changed::diagnostics-last-runtime-state",
            refreshStoredValues,
        );
        const errorChangedId = settings.connect(
            "changed::diagnostics-last-error",
            refreshStoredValues,
        );
        stateRow.connect("destroy", () => {
            settings.disconnect(stateChangedId);
            settings.disconnect(errorChangedId);
        });
    }

    _formatDiagnosticValue(value, emptyText) {
        if (!value) return emptyText;

        try {
            const data = JSON.parse(value);
            const pretty = JSON.stringify(data, null, 2);
            return pretty.length > 1400 ? `${pretty.slice(0, 1400)}…` : pretty;
        } catch (_error) {
            return value.slice(0, 1400);
        }
    }

    _formatDiagnosticError(value) {
        if (!value) return _("Помилок поки не зафіксовано.");

        try {
            const data = JSON.parse(value);
            return `${data.time} · ${data.area} · ${data.event}\n${data.message}`;
        } catch (_error) {
            return value.slice(0, 700);
        }
    }

    _buildDiagnosticsReport(settings) {
        let shellVersion = _("недоступна");
        try {
            const reply = Gio.DBus.session.call_sync(
                "org.gnome.Shell",
                "/org/gnome/Shell",
                "org.freedesktop.DBus.Properties",
                "Get",
                new GLib.Variant("(ss)", ["org.gnome.Shell", "ShellVersion"]),
                new GLib.VariantType("(v)"),
                Gio.DBusCallFlags.NONE,
                1000,
                null,
            );
            shellVersion = String(
                reply.get_child_value(0).get_variant().deep_unpack(),
            );
        } catch (_error) {
            // The remaining report is still useful if Shell's D-Bus property is unavailable.
        }

        const settingKeys = [
            "enabled",
            "brightness",
            "blur",
            "saturation",
            "grain",
            "search-entry-mode",
            "show-workspaces-thumbnails",
            "show-panel-in-overview",
            "show-dash-in-overview",
            "workspace-size",
            "workspace-spacing-vertical",
            "workspace-spacing-horizontal",
            "app-grid-columns",
            "app-grid-rows",
            "app-grid-icon-size",
            "app-grid-scroll-direction",
            "diagnostics-level",
        ];
        const configuration = Object.fromEntries(
            settingKeys.map((key) => [key, settings.get_value(key).deep_unpack()]),
        );
        const osName = GLib.get_os_info("PRETTY_NAME") ?? _("недоступно");

        return [
            "Alt Overview — звіт діагностики",
            `Зібрано: ${new Date().toISOString()}`,
            `Версія розширення: ${this.metadata.version}`,
            `GNOME Shell: ${shellVersion}`,
            `Система: ${osName}`,
            `Тип сеансу: ${GLib.getenv("XDG_SESSION_TYPE") ?? _("невідомий")}`,
            "",
            "Останній знімок стану:",
            this._formatDiagnosticValue(
                settings.get_string("diagnostics-last-runtime-state"),
                _("немає"),
            ),
            "",
            "Остання помилка:",
            this._formatDiagnosticError(
                settings.get_string("diagnostics-last-error"),
            ),
            "",
            "Параметри відтворення:",
            JSON.stringify(configuration, null, 2),
            "",
            "Зібрати журнал GNOME Shell за поточне завантаження:",
            "journalctl --user -b -o cat | grep -F '[alt-overview]'",
        ].join("\n");
    }

    // --- Вкладка "Загальне" ---
    _buildGeneralPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Загальне"),
            icon_name: "preferences-desktop-wallpaper-symbolic",
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _("Тло"),
        });
        page.add(group);

        // --- Рядок 1: Увімкнути тло (перемикач) ---
        const enableRow = new Adw.ExpanderRow({
            title: _("Увімкнути тло"),
        });
        const enableSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "enabled",
            enableSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        enableRow.add_suffix(enableSwitch);

        // --- Рядок 2: Яскравість (регулятор) ---
        const brightnessRow = new Adw.ActionRow({
            title: _("Яскравість"),
        });
        const brightnessControl = this._buildSettingsButtonRegulator(
            settings,
            "brightness",
            { lower: -100, upper: 100, step: 5 },
        );
        brightnessRow.add_suffix(brightnessControl.button);
        enableRow.add_row(brightnessRow);

        // --- Рядок 3: Розмиття (регулятор) ---
        const blurRow = new Adw.ActionRow({
            title: _("Розмиття"),
        });
        const blurControl = this._buildSettingsButtonRegulator(settings, "blur", {
            lower: 0,
            upper: 100,
            step: 5,
        });
        blurRow.add_suffix(blurControl.button);
        enableRow.add_row(blurRow);

        // --- Рядок 4: Насиченість (регулятор) ---
        const saturationRow = new Adw.ActionRow({
            title: _("Насиченість"),
        });
        const saturationControl = this._buildSettingsButtonRegulator(
            settings,
            "saturation",
            { lower: 0, upper: 2, step: 0.1, digits: 1, double: true },
        );
        saturationRow.add_suffix(saturationControl.button);
        enableRow.add_row(saturationRow);

        // --- Рядок 5: Зернистість (регулятор) ---
        const grainRow = new Adw.ActionRow({
            title: _("Зернистість"),
        });
        const grainControl = this._buildSettingsButtonRegulator(settings, "grain", {
            lower: 0,
            upper: 100,
            step: 5,
        });
        grainRow.add_suffix(grainControl.button);
        enableRow.add_row(grainRow);
        group.add(enableRow);

        const wallpaperRow = new Adw.ActionRow({
            title: _("Застосувати до шпалер робочого стола"),
        });
        const wallpaperSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "apply-to-wallpaper",
            wallpaperSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        wallpaperRow.add_suffix(wallpaperSwitch);
        wallpaperRow.activatable_widget = wallpaperSwitch;
        group.add(wallpaperRow);

        // --- Група "Елементи Огляду" ---
        const overviewElementsGroup = new Adw.PreferencesGroup({
            title: _("Елементи Огляду"),
        });
        page.add(overviewElementsGroup);

        const searchRow = new Adw.ActionRow({
            title: _("Показувати поле пошуку"),
        });
        const searchDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [
                    _("Завжди показувати"),
                    _("Ніколи не показувати"),
                    _("Показувати при наборі"),
                ],
            }),
            valign: Gtk.Align.CENTER,
        });
        const currentSearchEntryMode = settings.get_string(
            "search-entry-mode",
        );
        const currentSearchEntryModeIndex =
            SEARCH_ENTRY_MODES.indexOf(currentSearchEntryMode);
        searchDropdown.set_selected(
            currentSearchEntryModeIndex >= 0 ? currentSearchEntryModeIndex : 0,
        );

        searchDropdown.connect("notify::selected", () => {
            const value =
                SEARCH_ENTRY_MODES[searchDropdown.selected] ?? "always";
            if (settings.get_string("search-entry-mode") !== value)
                settings.set_string("search-entry-mode", value);
        });

        const searchEntryModeChangedId = settings.connect(
            "changed::search-entry-mode",
            () => {
                const value = settings.get_string("search-entry-mode");
                const index = SEARCH_ENTRY_MODES.indexOf(value);
                if (index >= 0 && index !== searchDropdown.selected)
                    searchDropdown.set_selected(index);
            },
        );
        searchDropdown.connect("destroy", () =>
            settings.disconnect(searchEntryModeChangedId),
        );

        searchRow.add_suffix(searchDropdown);
        overviewElementsGroup.add(searchRow);

        const workspacesRow = new Adw.ActionRow({
            title: _("Показувати мініатюри робочих столів"),
        });
        const workspacesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-workspaces-thumbnails",
            workspacesSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        workspacesRow.add_suffix(workspacesSwitch);
        workspacesRow.activatable_widget = workspacesSwitch;
        overviewElementsGroup.add(workspacesRow);

        const panelRow = new Adw.SwitchRow({
            title: _("Показувати панель в «Огляді»"),
        });
        settings.bind(
            "show-panel-in-overview",
            panelRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        overviewElementsGroup.add(panelRow);

        const dashRow = new Adw.SwitchRow({
            title: _("Показувати Dash в «Огляді»"),
        });
        settings.bind(
            "show-dash-in-overview",
            dashRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        overviewElementsGroup.add(dashRow);

        // --- Налаштування кліків із Close Overview ---
        const closeOverviewGroup = new Adw.PreferencesGroup({
            title: _("Налаштування кліків"),
        });
        page.add(closeOverviewGroup);

        for (const [key, title] of [
            ["close-on-left-click", _("Лівий клік")],
            ["close-on-right-click", _("Правий клік")],
            ["close-on-middle-click", _("Середній клік")],
        ]) {
            const row = new Adw.ActionRow({ title });
            const control = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
            });
            settings.bind(
                key,
                control,
                "active",
                Gio.SettingsBindFlags.DEFAULT,
            );
            row.add_suffix(control);
            row.activatable_widget = control;
            closeOverviewGroup.add(row);
        }
    }

    // --- Вкладка "Стільниці" ---
    _buildWorkspacesPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Стільниці"),
            icon_name: "view-grid-symbolic",
        });
        window.add(page);

        const sizeGroup = new Adw.PreferencesGroup({
            title: _("Розмір стільниці"),
        });
        page.add(sizeGroup);

        const sizeRow = new Adw.ActionRow({
            title: _("Розмір стільниці"),
        });
        const sizeControl = this._buildSettingsButtonRegulator(
            settings,
            "workspace-size",
            { lower: -100, upper: 100, step: 1 },
        );
        sizeRow.add_suffix(sizeControl.button);
        sizeGroup.add(sizeRow);

        this._addScrollDirectionGroup(
            page,
            settings,
            "workspaces-scroll-direction",
        );

        const closeButtonGroup = new Adw.PreferencesGroup({
            title: _("Кнопка закриття"),
        });
        page.add(closeButtonGroup);

        const closeButtonRow = new Adw.ActionRow({
            title: _("Показувати кнопку закриття вікна"),
        });
        const closeButtonSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-window-close-button",
            closeButtonSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        closeButtonRow.add_suffix(closeButtonSwitch);
        closeButtonRow.activatable_widget = closeButtonSwitch;
        closeButtonGroup.add(closeButtonRow);

        const tooltipGroup = new Adw.PreferencesGroup({
            title: _("Підказка"),
        });
        page.add(tooltipGroup);

        const tooltipRow = new Adw.ActionRow({
            title: _("Розташування"),
        });
        const tooltipDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [_("Над іконкою"), _("Під іконкою"), _("Приховати")],
            }),
            valign: Gtk.Align.CENTER,
        });

        const tooltipPositions = ["above", "below", "hidden"];
        const currentTooltipPosition = settings.get_string(
            "workspace-tooltip-position",
        );
        const currentTooltipIndex = tooltipPositions.indexOf(
            currentTooltipPosition,
        );
        tooltipDropdown.set_selected(
            currentTooltipIndex >= 0 ? currentTooltipIndex : 0,
        );

        tooltipDropdown.connect("notify::selected", () => {
            const value = tooltipPositions[tooltipDropdown.selected] ?? "above";
            if (settings.get_string("workspace-tooltip-position") !== value)
                settings.set_string("workspace-tooltip-position", value);
        });

        tooltipRow.add_suffix(tooltipDropdown);
        tooltipGroup.add(tooltipRow);
    }

    // --- Вкладка "Сітка програм" ---
    _buildAppGridPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Сітка програм"),
            icon_name: "view-app-grid-symbolic",
        });
        window.add(page);

        // Створюємо групу "Розкладка"
        const gridGroup = new Adw.PreferencesGroup({
            title: _("Розкладка"),
        });
        page.add(gridGroup);

        // --- Рядок: Кількість стовбців ---
        const colsRow = new Adw.ActionRow({
            title: _("Кількість стовбців"),
        });
        const colsControl = this._buildSettingsButtonRegulator(
            settings,
            "app-grid-columns",
            { lower: 4, upper: 8, step: 1 },
        );
        colsRow.add_suffix(colsControl.button);
        gridGroup.add(colsRow);

        // --- Рядок: Кількість рядків ---
        const rowsRow = new Adw.ActionRow({
            title: _("Кількість рядків"),
        });
        const rowsControl = this._buildSettingsButtonRegulator(
            settings,
            "app-grid-rows",
            { lower: 2, upper: 4, step: 1 },
        );
        rowsRow.add_suffix(rowsControl.button);
        gridGroup.add(rowsRow);

        // --- Рядок: Згасання по краях ---
        const edgeFadeRow = new Adw.ActionRow({
            title: _("Згасання по краях"),
        });
        const edgeFadeControl = this._buildSettingsButtonRegulator(
            settings,
            "app-grid-edge-fade",
            { lower: 0, upper: 200, step: 5 },
        );
        edgeFadeRow.add_suffix(edgeFadeControl.button);
        gridGroup.add(edgeFadeRow);

        const iconSizeGroup = new Adw.PreferencesGroup({
            title: _("Іконки"),
        });
        page.add(iconSizeGroup);

        const iconSizeRow = new Adw.ActionRow({
            title: _("Розмір"),
        });
        const iconSizeDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [
                    _("Найменший"),
                    _("Малий"),
                    _("Звичайний"),
                    _("Великий"),
                    _("Найбільший"),
                ],
            }),
            valign: Gtk.Align.CENTER,
        });

        const currentIconSizeValue = settings.get_string("app-grid-icon-size");
        const currentIconSizeIndex =
            APP_GRID_ICON_SIZE.indexOf(currentIconSizeValue);
        iconSizeDropdown.set_selected(
            currentIconSizeIndex >= 0 ? currentIconSizeIndex : 2,
        );

        iconSizeDropdown.connect("notify::selected", () => {
            const value =
                APP_GRID_ICON_SIZE[iconSizeDropdown.selected] ?? "normal";
            if (settings.get_string("app-grid-icon-size") !== value)
                settings.set_string("app-grid-icon-size", value);
        });

        // Синхронізуємо рядок, якщо значення зміниться ззовні.
        const iconSizeChangedId = settings.connect(
            "changed::app-grid-icon-size",
            () => {
                const value = settings.get_string("app-grid-icon-size");
                const index = APP_GRID_ICON_SIZE.indexOf(value);
                if (index >= 0 && index !== iconSizeDropdown.selected)
                    iconSizeDropdown.set_selected(index);
            },
        );
        iconSizeDropdown.connect("destroy", () =>
            settings.disconnect(iconSizeChangedId),
        );

        iconSizeRow.add_suffix(iconSizeDropdown);
        iconSizeGroup.add(iconSizeRow);

        iconSizeGroup.add(
            this._buildIconScaleRow(settings, {
                title: _("Масштаб при наведенні"),
                settingsKey: "app-grid-icon-hover-scale",
            }),
        );
        iconSizeGroup.add(
            this._buildIconScaleRow(settings, {
                title: _("Масштаб при натисканні"),
                settingsKey: "app-grid-icon-press-scale",
            }),
        );

        const namesRow = new Adw.ActionRow({
            title: _("Відображення назв"),
        });
        const namesDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [
                    _("Завжди показувати"),
                    _("Ніколи не показувати"),
                    _("Показувати при наведенні"),
                ],
            }),
            valign: Gtk.Align.CENTER,
        });

        const currentNamesValue = settings.get_string(
            "app-grid-names-visibility",
        );
        const currentNamesIndex =
            APP_GRID_NAMES_VISIBILITY.indexOf(currentNamesValue);
        namesDropdown.set_selected(
            currentNamesIndex >= 0 ? currentNamesIndex : 0,
        );

        namesDropdown.connect("notify::selected", () => {
            const value =
                APP_GRID_NAMES_VISIBILITY[namesDropdown.selected] ?? "always";
            if (settings.get_string("app-grid-names-visibility") !== value)
                settings.set_string("app-grid-names-visibility", value);
        });

        // Синхронізуємо рядок, якщо значення зміниться ззовні
        // (наприклад, через dconf-editor чи gsettings у терміналі).
        const namesChangedId = settings.connect(
            "changed::app-grid-names-visibility",
            () => {
                const value = settings.get_string("app-grid-names-visibility");
                const index = APP_GRID_NAMES_VISIBILITY.indexOf(value);
                if (index >= 0 && index !== namesDropdown.selected)
                    namesDropdown.set_selected(index);
            },
        );
        namesDropdown.connect("destroy", () =>
            settings.disconnect(namesChangedId),
        );

        namesRow.add_suffix(namesDropdown);
        iconSizeGroup.add(namesRow);

        const centerLastRowRow = new Adw.ActionRow({
            title: _("Центрувати останній неповний рядок"),
        });
        const centerLastRowSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "app-grid-center-last-row",
            centerLastRowSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        centerLastRowRow.add_suffix(centerLastRowSwitch);
        centerLastRowRow.activatable_widget = centerLastRowSwitch;
        iconSizeGroup.add(centerLastRowRow);

        this._addIconAnimationGroups(page, settings);

        // Додаємо напрямок прокручування до групи "Розкладка".
        this._addScrollDirectionGroup(
            page,
            settings,
            "app-grid-scroll-direction",
            gridGroup,
        );

        const navigationGroup = new Adw.PreferencesGroup({
            title: _("Навігація"),
        });
        page.add(navigationGroup);

        const navigationRow = new Adw.ActionRow({
            title: _("Кнопки навігації"),
        });
        const navigationSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-app-grid-navigation-buttons",
            navigationSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        navigationRow.add_suffix(navigationSwitch);
        navigationRow.activatable_widget = navigationSwitch;
        navigationGroup.add(navigationRow);

        const orderGroup = new Adw.PreferencesGroup({
            title: _("Програми"),
        });
        page.add(orderGroup);

        const orderRow = new Adw.ActionRow({
            title: _("Упорядкувати:"),
        });
        const orderDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [
                    _("Ручний"),
                    _("A → Z / А → Я"),
                    _("Z → A / Я → А"),
                    _("За частотою використання"),
                    _("За останнім запуском"),
                ],
            }),
            valign: Gtk.Align.CENTER,
        });
        const currentOrder = APP_GRID_ORDER.indexOf(
            settings.get_string("app-grid-order"),
        );
        orderDropdown.set_selected(currentOrder >= 0 ? currentOrder : 0);
        orderDropdown.connect("notify::selected", () => {
            const value = APP_GRID_ORDER[orderDropdown.selected] ?? "manual";
            if (settings.get_string("app-grid-order") !== value)
                settings.set_string("app-grid-order", value);
        });
        const orderChangedId = settings.connect(
            "changed::app-grid-order",
            () => {
                const value = settings.get_string("app-grid-order");
                const index = APP_GRID_ORDER.indexOf(value);
                if (index >= 0 && index !== orderDropdown.selected)
                    orderDropdown.set_selected(index);
            },
        );
        orderDropdown.connect("destroy", () =>
            settings.disconnect(orderChangedId),
        );
        orderRow.add_suffix(orderDropdown);
        orderGroup.add(orderRow);

        const pinnedAppsRow = new Adw.ActionRow({
            title: _("Показувати пришпилені програми"),
        });
        const pinnedAppsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-pinned-apps",
            pinnedAppsSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        pinnedAppsRow.add_suffix(pinnedAppsSwitch);
        pinnedAppsRow.activatable_widget = pinnedAppsSwitch;
        orderGroup.add(pinnedAppsRow);

        const contextMenuGroup = new Adw.PreferencesGroup({
            title: _("Контекстне меню"),
        });
        page.add(contextMenuGroup);

        const desktopFileRow = new Adw.ActionRow({
            title: _("Відкрити .desktop"),
        });
        const desktopFileSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "app-grid-show-open-desktop-file",
            desktopFileSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        desktopFileRow.add_suffix(desktopFileSwitch);
        desktopFileRow.activatable_widget = desktopFileSwitch;
        contextMenuGroup.add(desktopFileRow);
    }

    // Спільний будівник рядка напрямку прокручування. За замовчуванням
    // створює окрему групу "Орієнтація"; сітка програм додає рядок до
    // наявної групи "Розкладка".
    _addScrollDirectionGroup(page, settings, settingsKey, targetGroup = null) {
        const group = targetGroup ?? new Adw.PreferencesGroup({
            title: _("Орієнтація"),
        });
        if (!targetGroup) page.add(group);

        const row = new Adw.ActionRow({
            title: _("Напрямок прокручування"),
        });
        const dropdown = new Gtk.DropDown({
            model: new Gtk.StringList({
                strings: [_("Вертикальний"), _("Горизонтальний")],
            }),
            valign: Gtk.Align.CENTER,
        });

        const currentValue = settings.get_string(settingsKey);
        const currentIndex = SCROLL_DIRECTIONS.indexOf(currentValue);
        dropdown.set_selected(currentIndex >= 0 ? currentIndex : 0);

        dropdown.connect("notify::selected", () => {
            const direction =
                SCROLL_DIRECTIONS[dropdown.selected] ?? "vertical";

            if (settings.get_string(settingsKey) !== direction)
                settings.set_string(settingsKey, direction);
        });

        const changedId = settings.connect(`changed::${settingsKey}`, () => {
            const value = settings.get_string(settingsKey);
            const index = SCROLL_DIRECTIONS.indexOf(value);

            if (index >= 0 && index !== dropdown.selected)
                dropdown.set_selected(index);
        });

        dropdown.connect("destroy", () => settings.disconnect(changedId));

        row.add_suffix(dropdown);
        group.add(row);

        /*
         * Для вкладки "Стільниці" додаємо кнопку-регулятор відстані.
         * Для "Сітки програм" ця частина не створюється.
         */
        if (settingsKey !== "workspaces-scroll-direction") return;

        const spacingRow = new Adw.ActionRow({
            title: _("Відстань між стільницями"),
        });

        const getSpacingKey = () => {
            return settings.get_string("workspaces-scroll-direction") ===
                "vertical"
                ? "workspace-spacing-vertical"
                : "workspace-spacing-horizontal";
        };

        const spacingControl = this._buildButtonRegulator({
            getValue: () => settings.get_int(getSpacingKey()),
            setValue: (value) => settings.set_int(getSpacingKey(), value),
            lower: 0,
            upper: 100,
            step: 1,
        });

        spacingRow.add_suffix(spacingControl.button);
        group.add(spacingRow);

        /*
         * Встановлює кнопку з поточним значенням
         * активного напрямку.
         */
        const refreshSpacing = () => spacingControl.refresh();

        /*
         * При перемиканні вертикального/горизонтального режиму
         * показуємо збережене значення відповідного ключа.
         */
        const directionChangedId = settings.connect(
            "changed::workspaces-scroll-direction",
            refreshSpacing,
        );

        /*
         * Якщо значення змінене зовні через GSettings,
         * синхронізуємо кнопку.
         */
        const verticalSpacingChangedId = settings.connect(
            "changed::workspace-spacing-vertical",
            () => {
                if (getSpacingKey() === "workspace-spacing-vertical")
                    refreshSpacing();
            },
        );

        const horizontalSpacingChangedId = settings.connect(
            "changed::workspace-spacing-horizontal",
            () => {
                if (getSpacingKey() === "workspace-spacing-horizontal")
                    refreshSpacing();
            },
        );

        spacingRow.connect("destroy", () => {
            settings.disconnect(directionChangedId);
            settings.disconnect(verticalSpacingChangedId);
            settings.disconnect(horizontalSpacingChangedId);
        });
    }

    // Група анімації іконок для вкладки "Сітка програм" — налаштування
    // bounce-масштабування іконок при наведенні та натисканні. Сама
    // анімація виконується в
    // extension.js/iconAnimations.js — тут лише інтерфейс налаштувань.
    _addIconAnimationGroups(page, settings) {
        const animGroup = new Adw.PreferencesGroup({
            title: _("Анімація"),
        });
        page.add(animGroup);

        animGroup.add(
            this._buildIconAnimationExpander(settings, {
                title: _("Анімація при наведенні"),
                curveKey: "app-grid-icon-hover-curve",
                inDurationsKey: "app-grid-icon-hover-in-durations",
                outDurationsKey: "app-grid-icon-hover-out-durations",
                inTitle: _("Швидкість при наведенні"),
                outTitle: _("Швидкість при відведенні"),
            }),
        );

        animGroup.add(
            this._buildIconAnimationExpander(settings, {
                title: _("Анімація при натисканні"),
                curveKey: "app-grid-icon-press-curve",
                inDurationsKey: "app-grid-icon-press-in-durations",
                outDurationsKey: "app-grid-icon-press-out-durations",
                inTitle: _("Швидкість при натисканні"),
                outTitle: _("Швидкість при відпусканні"),
            }),
        );
    }

    // Читає збережену тривалість для конкретної кривої з dict-налаштування
    // (тип "a{si}": ключ — назва кривої, значення — мс). Якщо для цієї
    // кривої ще нічого не збережено — фолбек 200 мс (той самий default,
    // що й у схемі).
    _getCurveDuration(settings, key, curveName) {
        const dict = settings.get_value(key).deep_unpack();
        return curveName in dict ? dict[curveName] : 200;
    }

    // Записує тривалість лише для однієї кривої, не чіпаючи збережені
    // значення інших кривих у тому ж dict-налаштуванні.
    _setCurveDuration(settings, key, curveName, value) {
        const dict = settings.get_value(key).deep_unpack();
        dict[curveName] = value;
        settings.set_value(key, new GLib.Variant("a{si}", dict));
    }

    // Один ExpanderRow з випадаючим меню кривої в кінці заголовка та
    // двома вкладеними ActionRow-регуляторами тривалості (розкриваються
    // при натисканні на рядок). Кожна крива пам'ятає власні значення
    // тривалості — перемикання кривої в меню підвантажує її власні
    // збережені швидкості, а не ділить одне спільне значення на всі.
    _buildIconAnimationExpander(
        settings,
        { title, curveKey, inDurationsKey, outDurationsKey, inTitle, outTitle },
    ) {
        const expander = new Adw.ExpanderRow({ title });

        const curveDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({ strings: ICON_ANIMATION_CURVES }),
            valign: Gtk.Align.CENTER,
            margin_end: 12,
        });

        const currentCurve = settings.get_string(curveKey);
        const currentCurveIndex = ICON_ANIMATION_CURVES.indexOf(currentCurve);
        curveDropdown.set_selected(
            currentCurveIndex >= 0 ? currentCurveIndex : 0,
        );

        const getCurveName = () =>
            ICON_ANIMATION_CURVES[curveDropdown.selected] ?? "Quad";

        const inRow = this._buildCurveDurationRow(
            settings,
            inDurationsKey,
            inTitle,
            getCurveName,
        );
        const outRow = this._buildCurveDurationRow(
            settings,
            outDurationsKey,
            outTitle,
            getCurveName,
        );

        curveDropdown.connect("notify::selected", () => {
            const value = getCurveName();
            if (settings.get_string(curveKey) !== value)
                settings.set_string(curveKey, value);
            // Показуємо тривалості, збережені саме для нової кривої.
            inRow.refresh();
            outRow.refresh();
        });

        // Синхронізуємо меню, якщо значення зміниться ззовні.
        const curveChangedId = settings.connect(`changed::${curveKey}`, () => {
            const value = settings.get_string(curveKey);
            const index = ICON_ANIMATION_CURVES.indexOf(value);
            if (index >= 0 && index !== curveDropdown.selected)
                curveDropdown.set_selected(index);
        });
        expander.connect("destroy", () => settings.disconnect(curveChangedId));

        expander.add_suffix(curveDropdown);
        expander.add_row(inRow.row);
        expander.add_row(outRow.row);

        return expander;
    }

    // Один ActionRow-регулятор тривалості (0–1000 мс, крок 50), значення
    // якого прив'язане до тривалості поточної (getCurveName()) кривої в
    // dict-налаштуванні durationsKey. Повертає { row, refresh } — refresh
    // перечитує значення для щойно обраної кривої без запису в dict.
    _buildCurveDurationRow(settings, durationsKey, title, getCurveName) {
        const row = new Adw.ActionRow({ title });
        const regulator = this._buildButtonRegulator({
            getValue: () =>
                this._getCurveDuration(settings, durationsKey, getCurveName()),
            setValue: (value) => {
                this._setCurveDuration(
                    settings,
                    durationsKey,
                    getCurveName(),
                    value,
                );
            },
            lower: 0,
            upper: 1000,
            step: 50,
        });
        row.add_suffix(regulator.button);

        const changedId = settings.connect(`changed::${durationsKey}`, () => {
            regulator.refresh();
        });
        row.connect("destroy", () => settings.disconnect(changedId));

        return {
            row,
            refresh: regulator.refresh,
        };
    }

    // Один ActionRow-кнопка-регулятор масштабу іконки (0.50–1.50).
    _buildIconScaleRow(settings, { title, settingsKey }) {
        const row = new Adw.ActionRow({ title });
        const regulator = this._buildSettingsButtonRegulator(settings, settingsKey, {
            lower: 0.5,
            upper: 1.5,
            step: 0.01,
            digits: 2,
            double: true,
        });
        row.add_suffix(regulator.button);
        return row;
    }

    // Створює кнопку-регулятор із таким самим виглядом та керуванням
    // прокручуванням, як у Panel Modifier.
    _buildButtonRegulator({ getValue, setValue, lower, upper, step = 1, digits = 0 }) {
        const format = (value) =>
            digits > 0 ? Number(value).toFixed(digits) : String(Math.round(value));

        const button = new Gtk.Button({
            label: format(getValue()),
            valign: Gtk.Align.CENTER,
        });
        button.set_size_request(72, -1);

        const refresh = () => {
            button.label = format(getValue());
        };

        const scrollCtrl = new Gtk.EventControllerScroll({
            flags:
                Gtk.EventControllerScrollFlags.VERTICAL |
                Gtk.EventControllerScrollFlags.HORIZONTAL,
        });

        scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
            const direction = dy < 0 || dx < 0 ? 1 : dy > 0 || dx > 0 ? -1 : 0;
            if (direction === 0) return true;

            const precision = 10 ** digits;
            const value = Math.max(
                lower,
                Math.min(upper, getValue() + direction * step),
            );
            setValue(Math.round(value * precision) / precision);
            refresh();
            return true;
        });
        button.add_controller(scrollCtrl);

        return { button, refresh };
    }

    _buildSettingsButtonRegulator(
        settings,
        settingsKey,
        { lower, upper, step = 1, digits = 0, double = false },
    ) {
        const getValue = double
            ? () => settings.get_double(settingsKey)
            : () => settings.get_int(settingsKey);
        const setValue = double
            ? (value) => settings.set_double(settingsKey, value)
            : (value) => settings.set_int(settingsKey, value);
        const regulator = this._buildButtonRegulator({
            getValue,
            setValue,
            lower,
            upper,
            step,
            digits,
        });

        const changedId = settings.connect(`changed::${settingsKey}`, () => {
            regulator.refresh();
        });
        regulator.button.connect("destroy", () => settings.disconnect(changedId));

        return regulator;
    }
}
