import Cairo from "cairo";
import Clutter from "gi://Clutter";
import St from "gi://St";
import GdkPixbuf from "gi://GdkPixbuf";

const RUNNING_INDICATOR_SETTING_KEYS = new Set([
    "app-grid-running-indicator-width",
    "app-grid-running-indicator-height",
    "app-grid-running-indicator-radius",
    "app-grid-running-indicator-corners",
    "app-grid-running-indicator-position-x",
    "app-grid-running-indicator-position-y",
    "app-grid-running-indicator-dynamic-color",
]);

function getAverageAppIconColor(app) {
    try {
        const gicon = app?.get_icon();
        if (!gicon) return null;

        const theme =
            typeof St.IconTheme.get_default === "function"
                ? St.IconTheme.get_default()
                : new St.IconTheme();
        const iconInfo = theme.lookup_by_gicon(
            gicon,
            48,
            St.IconLookupFlags.NONE,
        );
        const filename = iconInfo?.get_filename();
        if (!filename) return null;

        const pixels = GdkPixbuf.Pixbuf.new_from_file(filename)
            .scale_simple(1, 1, GdkPixbuf.InterpType.BILINEAR)
            .get_pixels();

        return [pixels[0] / 255, pixels[1] / 255, pixels[2] / 255];
    } catch {
        return null;
    }
}

function getThemeIndicatorColor(themeProbe) {
    try {
        const themeNode = themeProbe?.peek_theme_node?.();
        if (!themeNode) return null;

        const color = themeNode.get_background_color();
        if (!color || color.alpha <= 0) return null;

        return [color.red / 255, color.green / 255, color.blue / 255];
    } catch {
        return null;
    }
}

function drawRunningIndicator(area) {
    const cr = area.get_context();

    try {
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) return;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.setAntialias(Cairo.Antialias.BEST);

        const color =
            area._chDotColor ??
            area._chThemeColor ??
            [0.75, 0.75, 0.75];
        const cornerCount = Math.max(
            3,
            Math.min(12, Math.round(Number(area._chDotCorners) || 4)),
        );
        const requestedRadius = Math.max(0, Number(area._chDotRadius) || 0);

        // Odd polygons have a top vertex; even polygons have a horizontal top edge.
        const startAngle =
            cornerCount % 2 === 0
                ? -Math.PI / 2 - Math.PI / cornerCount
                : -Math.PI / 2;
        const angles = Array.from(
            { length: cornerCount },
            (_, index) => startAngle + (2 * Math.PI * index) / cornerCount,
        );

        const maxX = Math.max(...angles.map((angle) => Math.abs(Math.cos(angle))));
        const maxY = Math.max(...angles.map((angle) => Math.abs(Math.sin(angle))));
        const inset = 0.75;
        const polygonRadius = Math.min(
            (width / 2 - inset) / maxX,
            (height / 2 - inset) / maxY,
        );
        if (!Number.isFinite(polygonRadius) || polygonRadius <= 0) return;

        const centerX = width / 2;
        const centerY = height / 2;
        const vertices = angles.map((angle) => ({
            x: centerX + Math.cos(angle) * polygonRadius,
            y: centerY + Math.sin(angle) * polygonRadius,
        }));

        const sideLength = Math.hypot(
            vertices[1].x - vertices[0].x,
            vertices[1].y - vertices[0].y,
        );
        const exteriorAngle = (2 * Math.PI) / cornerCount;
        const interiorAngle = Math.PI - exteriorAngle;
        const tangentFactor = Math.tan(interiorAngle / 2);
        const cornerRadius = Math.min(
            requestedRadius,
            (sideLength / 2) * tangentFactor,
        );

        cr.setSourceRGB(color[0], color[1], color[2]);

        if (cornerRadius <= 0.01) {
            cr.moveTo(vertices[0].x, vertices[0].y);
            for (let index = 1; index < vertices.length; index++)
                cr.lineTo(vertices[index].x, vertices[index].y);
            cr.closePath();
        } else {
            const tangentDistance = cornerRadius / tangentFactor;
            const bisectorDistance =
                cornerRadius / Math.sin(interiorAngle / 2);

            const roundedCorners = vertices.map((vertex, index) => {
                const previous = vertices[
                    (index - 1 + cornerCount) % cornerCount
                ];
                const next = vertices[(index + 1) % cornerCount];

                const toPrevious = {
                    x: (previous.x - vertex.x) / sideLength,
                    y: (previous.y - vertex.y) / sideLength,
                };
                const toNext = {
                    x: (next.x - vertex.x) / sideLength,
                    y: (next.y - vertex.y) / sideLength,
                };
                const bisectorX = toPrevious.x + toNext.x;
                const bisectorY = toPrevious.y + toNext.y;
                const bisectorLength = Math.hypot(bisectorX, bisectorY);

                const entry = {
                    x: vertex.x + toPrevious.x * tangentDistance,
                    y: vertex.y + toPrevious.y * tangentDistance,
                };
                const center = {
                    x: vertex.x + (bisectorX / bisectorLength) * bisectorDistance,
                    y: vertex.y + (bisectorY / bisectorLength) * bisectorDistance,
                };

                return {
                    entry,
                    center,
                    startAngle: Math.atan2(
                        entry.y - center.y,
                        entry.x - center.x,
                    ),
                };
            });

            cr.moveTo(roundedCorners[0].entry.x, roundedCorners[0].entry.y);
            for (let index = 0; index < cornerCount; index++) {
                const corner = roundedCorners[index];
                cr.arc(
                    corner.center.x,
                    corner.center.y,
                    cornerRadius,
                    corner.startAngle,
                    corner.startAngle + exteriorAngle,
                );
                const nextCorner = roundedCorners[(index + 1) % cornerCount];
                cr.lineTo(nextCorner.entry.x, nextCorner.entry.y);
            }
            cr.closePath();
        }

        cr.fill();
    } finally {
        // St.DrawingArea returns a Cairo context that GJS must explicitly dispose.
        cr.$dispose();
    }
}

export class RunningIndicators {
    constructor(settings) {
        this._settings = settings;
    }

    ensureOverlay(item, iconSize = null) {
        const icon = item?.icon?.icon;
        const iconBin = item?.icon?._iconBin;
        const nativeDot = item?._dot;

        if (!icon || !iconBin || !nativeDot) return;

        if (
            item._chRunningOverlay &&
            !item._chRunningOverlay.is_destroyed?.() &&
            item._chRunningOverlayIcon === icon
        ) {
            const size =
                Number.isFinite(iconSize) && iconSize > 0
                    ? iconSize
                    : Number(icon._chFixedPreferredSize) || Number(icon.width);
            this._updateOverlayGeometry(item, size);
            return;
        }

        if (
            item._chRunningOverlay &&
            !item._chRunningOverlay.is_destroyed?.()
        ) {
            this._disconnectSettingsListener(item);
            item._chRunningOverlay.destroy();
        }

        item._chRunningOverlay = null;
        item._chRunningOverlayIcon = null;
        nativeDot.opacity = 0;

        const overlay = new Clutter.Actor({
            layout_manager: new Clutter.FixedLayout(),
        });
        overlay.clip_to_allocation = false;
        overlay.set_pivot_point(0.5, 0.5);
        overlay._chPreferredSize = 1;
        overlay.get_preferred_size = function () {
            const size = this._chPreferredSize;
            return [size, size, size, size];
        };

        if (icon.get_parent() === iconBin) iconBin.remove_child(icon);
        iconBin.child = overlay;
        overlay.add_child(icon);

        const dot = new St.DrawingArea({
            style_class: "ch-app-grid-running-dot",
            reactive: false,
            can_focus: false,
        });
        dot._chDotColor = this._settings.get_boolean(
            "app-grid-running-indicator-dynamic-color",
        )
            ? getAverageAppIconColor(item.app)
            : null;
        dot._chThemeColor = null;

        const themeProbe = new St.Widget({
            style_class: "indicator-dot active",
            reactive: false,
            can_focus: false,
            opacity: 0,
        });
        themeProbe.set_size(1, 1);
        themeProbe.set_position(-1, -1);
        themeProbe.connect("style-changed", () => {
            const color = getThemeIndicatorColor(themeProbe);
            if (!color) return;

            dot._chThemeColor = color;
            if (!this._settings.get_boolean(
                "app-grid-running-indicator-dynamic-color",
            ))
                dot.queue_repaint();
        });
        overlay.add_child(themeProbe);
        dot._chThemeProbe = themeProbe;
        dot._chThemeColor = getThemeIndicatorColor(themeProbe);
        dot._chDotCorners = this._settings.get_int(
            "app-grid-running-indicator-corners",
        );
        dot._chDotRadius = this._settings.get_int(
            "app-grid-running-indicator-radius",
        );
        dot.connect("repaint", drawRunningIndicator);
        dot.clip_to_allocation = false;
        overlay.add_child(dot);

        item._chRunningOverlay = overlay;
        item._chRunningOverlayIcon = icon;
        item._chRunningDot = dot;
        item._chRunningDotVisibleId = nativeDot.connect(
            "notify::visible",
            () => {
                if (
                    item._chRunningDot &&
                    !item._chRunningDot.is_destroyed?.()
                ) {
                    item._chRunningDot.visible = nativeDot.visible;
                }
            },
        );
        item._chRunningSettingsChangedId = this._settings.connect(
            "changed",
            (_settings, key) => {
                if (!RUNNING_INDICATOR_SETTING_KEYS.has(key)) return;

                if (key === "app-grid-running-indicator-dynamic-color") {
                    dot._chDotColor = this._settings.get_boolean(
                        "app-grid-running-indicator-dynamic-color",
                    )
                        ? getAverageAppIconColor(item.app)
                        : null;

                    const themeColor = getThemeIndicatorColor(
                        dot._chThemeProbe,
                    );
                    if (themeColor) dot._chThemeColor = themeColor;
                    dot.queue_repaint();
                }

                const currentSize =
                    Number(icon._chFixedPreferredSize) || Number(icon.width);
                this._updateOverlayGeometry(item, currentSize);
            },
        );
        dot.visible = nativeDot.visible;

        const size =
            Number.isFinite(iconSize) && iconSize > 0
                ? iconSize
                : Number(icon._chFixedPreferredSize) || Number(icon.width);
        this._updateOverlayGeometry(item, size);
    }

    _disconnectSettingsListener(item) {
        const handlerId = item?._chRunningSettingsChangedId;
        if (!handlerId) return;

        try {
            this._settings.disconnect(handlerId);
        } catch (_error) {
            // The item may already be in teardown.
        }
        item._chRunningSettingsChangedId = 0;
    }

    updateOverlayGeometry(item, iconSize) {
        this._updateOverlayGeometry(item, iconSize);
    }

    restore(item, icon, iconBin) {
        const nativeDot = item?._dot;
        const overlay = item?._chRunningOverlay;

        this._disconnectSettingsListener(item);

        if (
            item?._chRunningDotVisibleId &&
            nativeDot &&
            !nativeDot.is_destroyed?.()
        ) {
            nativeDot.disconnect(item._chRunningDotVisibleId);
            item._chRunningDotVisibleId = 0;
        }

        if (
            icon &&
            iconBin &&
            overlay &&
            !overlay.is_destroyed?.() &&
            !icon.is_destroyed?.()
        ) {
            if (icon.get_parent() === overlay) overlay.remove_child(icon);
            iconBin.child = icon;
        }

        item._chRunningDot = null;
        if (overlay && !overlay.is_destroyed?.()) overlay.destroy();
        item._chRunningOverlay = null;
        item._chRunningOverlayIcon = null;

        if (nativeDot && !nativeDot.is_destroyed?.()) nativeDot.opacity = 255;
    }

    _updateOverlayGeometry(item, iconSize) {
        const overlay = item?._chRunningOverlay;
        const icon = item?._chRunningOverlayIcon;
        const dot = item?._chRunningDot;

        if (
            !overlay ||
            !icon ||
            !dot ||
            overlay.is_destroyed?.() ||
            icon.is_destroyed?.() ||
            dot.is_destroyed?.()
        ) {
            return;
        }

        const size = Number(iconSize);
        if (!Number.isFinite(size) || size <= 0) return;

        // Keep the BinLayout preferred size synchronized with the actual
        // overlay size. A stale preferred size of 1x1 makes CENTER alignment
        // allocate the overlay using the wrong geometry after re-enable.
        if (overlay._chPreferredSize !== size) {
            overlay._chPreferredSize = size;
            overlay.queue_relayout();
        }
        overlay.set_size(size, size);
        icon.set_position(0, 0);
        icon.set_size(size, size);

        const dotWidth = this._settings.get_int(
            "app-grid-running-indicator-width",
        );
        const dotHeight = this._settings.get_int(
            "app-grid-running-indicator-height",
        );
        const dotRadius = this._settings.get_int(
            "app-grid-running-indicator-radius",
        );
        const dotCorners = this._settings.get_int(
            "app-grid-running-indicator-corners",
        );
        const horizontalPosition = this._settings.get_int(
            "app-grid-running-indicator-position-x",
        );
        const verticalPosition = this._settings.get_int(
            "app-grid-running-indicator-position-y",
        );

        dot._chDotRadius = dotRadius;
        dot._chDotCorners = dotCorners;
        dot.set_size(dotWidth, dotHeight);
        dot.set_position(
            Math.round(((size - dotWidth) * (horizontalPosition + 100)) / 200),
            Math.round(((size - dotHeight) * (verticalPosition + 100)) / 200),
        );
        dot.queue_repaint();

        overlay.clip_to_allocation = false;
        icon.clip_to_allocation = false;
        dot.clip_to_allocation = false;
    }
}
